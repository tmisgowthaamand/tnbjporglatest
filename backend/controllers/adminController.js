const ExcelJS = require('exceljs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const User = require('../models/User');
const SchemeApplication = require('../models/SchemeApplication');
const SchemeSuggestion = require('../models/SchemeSuggestion');
const IncompleteRegistration = require('../models/IncompleteRegistration');
const BoothPresidentRequest = require('../models/BoothPresidentRequest');
const { BJP_SCHEMES } = require('../constants/schemes');
const { districtSpellingsFilter } = require('../utils/districtNormalizer');

// Resolve a stored schemeName (often the numeric scheme id, since the chatbot
// submits scheme ids) to a human-readable scheme name for display / exports.
// Escape a string so it can be embedded safely inside a RegExp. Prevents
// regex-injection / ReDoS from user-supplied filter and search values.
const escapeRegex = (str) => String(str == null ? '' : str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GeoJSON canonical names differ from what the DB stores for 3 districts.
// When a map-click sends e.g. "Nilgiris", map it to "THE NILGIRIS" before querying.
const GEOJSON_TO_DB_DISTRICT = {
  'nilgiris':   'THE NILGIRIS',
  'villupuram': 'VILUPPURAM',
  'sivagangai': 'SIVAGANGA',
};
const toDbDistrict = (name) => {
  if (!name) return name;
  return GEOJSON_TO_DB_DISTRICT[name.trim().toLowerCase()] || name.trim();
};

const resolveSchemeName = (schemeName, schemeId) => {
  const raw = String(schemeName == null ? '' : schemeName).trim();
  const byId = BJP_SCHEMES.find(s => String(s.id) === raw || (schemeId != null && String(s.id) === String(schemeId)));
  if (/^\d+$/.test(raw) && byId) return byId.name;
  const byName = BJP_SCHEMES.find(s => s.name.toLowerCase() === raw.toLowerCase());
  if (byName) return byName.name;
  const byKey = BJP_SCHEMES.find(s => (s.keys || []).some(k => k && raw.toLowerCase().includes(k)));
  if (byKey) return byKey.name;
  return raw || (byId ? byId.name : '—');
};
const { getVoterDbClient } = require('../config/db');
const {
  getAssemblyMetadata,
  getDistrictCredentialsList,
  getAssemblyCredentialsList,
  getBoothCredentialsForAssembly,
  authenticateDynamicAdmin,
  getCollectionsForDistrict,
  getCollectionForAssembly,
  getDistrictVoterRollCount,
  getAssemblyVoterRollCount,
  getAllAssemblyVoterCounts,
  getBoothVoterRollCount,
  getStateVoterRollCount
} = require('../services/jurisdictionService');

const generateAdminToken = (admin) => {
  return jwt.sign(
    {
      id: admin._id || admin.id,
      username: admin.username,
      role: admin.role,
      district: admin.district,
      assemblyName: admin.assemblyName,
      boothNo: admin.boothNo,
      isAdmin: true,
      tokenVersion: admin.tokenVersion || 1
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Helper: Get scoping query for admin role
const getAdminScopeQuery = (admin) => {
  const query = {};
  if (admin.role === 'DISTRICT_ADMIN' && admin.district) {
    query.district = new RegExp('^' + escapeRegex(admin.district) + '$', 'i');
  } else if (admin.role === 'ASSEMBLY_ADMIN') {
    if (admin.district) query.district = new RegExp('^' + escapeRegex(admin.district) + '$', 'i');
    if (admin.assemblyName) query.assemblyName = new RegExp('^' + escapeRegex(admin.assemblyName) + '$', 'i');
  } else if (admin.role === 'BOOTH_ADMIN') {
    if (admin.district) query.district = new RegExp('^' + escapeRegex(admin.district) + '$', 'i');
    if (admin.assemblyName) query.assemblyName = new RegExp('^' + escapeRegex(admin.assemblyName) + '$', 'i');
    if (admin.boothNo) query.boothNo = String(admin.boothNo);
  }
  return query;
};

// ── Dashboard stats cache (5-min TTL, keyed by admin scope + query filters) ──
// Dashboard aggregates are expensive; cache them briefly per scope. The cache is
// cleared whenever an application status changes so admins see fresh numbers.
const _statsCache = new Map();
const STATS_TTL_MS = 30 * 60 * 1000;
const _mapCache = new Map();
const MAP_CACHE_TTL_MS = 5 * 60 * 1000;
const statsCacheKey = (admin, q = {}) => JSON.stringify({
  r: admin.role || '', d: admin.district || '', a: admin.assemblyName || '', b: admin.boothNo || '',
  qd: q.district || '', qa: q.assemblyName || '', qb: q.boothNo || ''
});
const invalidateStatsCache = () => { _statsCache.clear(); _mapCache.clear(); _trendsCache.clear(); _coverageCache.clear(); };

const _trendsCache = new Map();
const _coverageCache = new Map();
const TRENDS_TTL_MS = 2 * 60 * 1000;
const COVERAGE_TTL_MS = 2 * 60 * 1000;
const scopeCacheKey = (admin) => JSON.stringify({ r: admin.role || '', d: admin.district || '', a: admin.assemblyName || '', b: admin.boothNo || '' });

// @desc    Admin Login
// @route   POST /api/admin/login
// @access  Public
const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    // 1. Check Mongoose DB
    const admin = await Admin.findOne({ username: cleanUsername });
    if (admin) {
      const isMatch = await admin.matchPassword(cleanPassword);
      if (isMatch) {
        admin.tokenVersion = (admin.tokenVersion || 1) + 1;
        await admin.save();
        const token = generateAdminToken(admin);
        return res.status(200).json({
          success: true,
          message: `Welcome ${admin.role} (${admin.username})`,
          token,
          admin: {
            id: admin._id,
            username: admin.username,
            role: admin.role,
            district: admin.district,
            assemblyName: admin.assemblyName,
            boothNo: admin.boothNo
          }
        });
      }
    }

    // 2. Check Dynamic Booth / Assembly / District Credential
    const dynamicAdmin = await authenticateDynamicAdmin(cleanUsername, cleanPassword);
    if (dynamicAdmin) {
      const token = generateAdminToken(dynamicAdmin);
      return res.status(200).json({
        success: true,
        message: `Welcome ${dynamicAdmin.role} (${dynamicAdmin.username})`,
        token,
        admin: dynamicAdmin
      });
    }

    return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
  } catch (error) {
    console.error('[adminLogin Error]:', error);
    return res.status(500).json({ success: false, message: 'Admin login failed' });
  }
};

// @desc    Get All Assemblies Metadata (for Assembly Dropdown)
// @route   GET /api/admin/jurisdiction-assemblies
// @access  Private (Admin)
const getAssembliesList = async (req, res) => {
  try {
    const assemblies = await getAssemblyMetadata();
    return res.status(200).json({
      success: true,
      count: assemblies.length,
      assemblies
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get All District Admin Credentials List
// @route   GET /api/admin/jurisdiction-district-credentials
// @access  Private (Admin)
const getDistrictCredentials = async (req, res) => {
  try {
    const districts = await getDistrictCredentialsList();
    return res.status(200).json({
      success: true,
      count: districts.length,
      districts
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get All Assembly Admin Credentials List
// @route   GET /api/admin/jurisdiction-assembly-credentials
// @access  Private (Admin)
const getAssemblyCredentials = async (req, res) => {
  try {
    const assemblies = await getAssemblyCredentialsList();
    return res.status(200).json({
      success: true,
      count: assemblies.length,
      assemblies
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get Generated Booth Credentials for selected Assembly
// @route   GET /api/admin/assembly-booth-credentials
// @access  Private (Admin)
const getAssemblyBoothCredentials = async (req, res) => {
  try {
    const { assemblyNo } = req.query;
    const targetNo = assemblyNo || '1';

    const data = await getBoothCredentialsForAssembly(targetNo);
    if (!data) {
      return res.status(404).json({ success: false, message: `Assembly #${targetNo} not found` });
    }

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get Admin Dashboard Scoped Statistics
// @route   GET /api/admin/dashboard-stats
// @access  Private (Admin)
const getDashboardStats = async (req, res) => {
  try {
    const admin = req.admin;
    const { district, assemblyName, boothNo, live } = req.query || {};

    // Serve from the 5-min scope cache when fresh (bypass with ?live=1).
    const _cacheKey = statsCacheKey(admin, req.query || {});
    const _cached = _statsCache.get(_cacheKey);
    if (_cached && Date.now() - _cached.at < STATS_TTL_MS && live !== '1') {
      return res.status(200).json(_cached.payload);
    }

    const scopeQuery = getAdminScopeQuery(admin);

    // Count from WRITE DB: unique enrolled members with scheme applications
    const [totalApplications, distinctMobileCount, totalRegisteredUsers, pendingVolunteers, totalVolunteers, totalIncomplete] = await Promise.all([
      SchemeApplication.countDocuments(scopeQuery),
      SchemeApplication.aggregate([
        { $match: scopeQuery },
        { $group: { _id: '$mobile' } },
        { $count: 'total' }
      ], { allowDiskUse: true }).then(r => r[0]?.total || 0),
      User.countDocuments(scopeQuery),
      BoothPresidentRequest.countDocuments({ ...scopeQuery, status: 'Pending' }),
      BoothPresidentRequest.countDocuments(scopeQuery),
      IncompleteRegistration.countDocuments({})
    ]);
    const totalVotersRequested = distinctMobileCount || totalApplications;

    // Count from READ DB: instant from in-memory cache
    let totalVotersInRoll = null;
    try {
      const activeBooth = boothNo || (admin.role === 'BOOTH_ADMIN' ? admin.boothNo : null);
      const activeAss   = assemblyName || admin.assemblyName;
      const activeDist  = district || admin.district;

      if (activeBooth && activeAss) {
        const cols = await getCollectionForAssembly(activeAss);
        if (cols && cols.length > 0) {
          const voterDb = await getVoterDbClient();
          const bStr = String(activeBooth);
          const bNum = parseInt(activeBooth);
          totalVotersInRoll = await voterDb.collection(cols[0]).countDocuments({
            $or: [{ PART_NO: bStr }, { PART_NO: bNum }]
          });
        }
      } else if (activeAss) {
        totalVotersInRoll = await getAssemblyVoterRollCount(activeAss);
      } else if (activeDist) {
        totalVotersInRoll = await getDistrictVoterRollCount(activeDist);
      } else {
        totalVotersInRoll = await getStateVoterRollCount();
      }
    } catch (rollErr) {
      console.error('[ReadDB VoterCount Error]:', rollErr.message);
    }

    // ── Execute all aggregation queries in parallel (O(1) execution time) ──
    const [
      statusCounts,
      rawDistrictStats,
      rawAssemblyStats,
      rawBoothStats,
      rawPopularity,
      topReferrersRaw
    ] = await Promise.all([
      SchemeApplication.aggregate([
        { $match: scopeQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ], { allowDiskUse: true }),

      SchemeApplication.aggregate([
        { $match: scopeQuery },
        {
          $group: {
            _id: '$district',
            totalApps: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', ['Submitted', 'Pending', 'In Progress', 'Called']] }, 1, 0] } },
            voterIds: { $addToSet: { $ifNull: ['$epicNo', '$mobile'] } }
          }
        },
        {
          $project: {
            _id: 1,
            totalApps: 1,
            approved: 1,
            pending: 1,
            appliedVoters: { $size: '$voterIds' }
          }
        },
        { $sort: { totalApps: -1 } }
      ], { allowDiskUse: true }),

      SchemeApplication.aggregate([
        { $match: scopeQuery },
        {
          $group: {
            _id: { district: '$district', assemblyName: '$assemblyName' },
            totalApps: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', ['Submitted', 'Pending', 'In Progress', 'Called']] }, 1, 0] } },
            voterIds: { $addToSet: { $ifNull: ['$epicNo', '$mobile'] } }
          }
        },
        {
          $project: {
            _id: 1,
            totalApps: 1,
            approved: 1,
            pending: 1,
            appliedVoters: { $size: '$voterIds' }
          }
        },
        { $sort: { totalApps: -1 } },
        { $limit: 50 }
      ], { allowDiskUse: true }),

      SchemeApplication.aggregate([
        { $match: scopeQuery },
        {
          $group: {
            _id: { district: '$district', assemblyName: '$assemblyName', boothNo: '$boothNo' },
            totalApps: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', ['Submitted', 'Pending', 'In Progress', 'Called']] }, 1, 0] } },
            voterIds: { $addToSet: { $ifNull: ['$epicNo', '$mobile'] } }
          }
        },
        {
          $project: {
            _id: 1,
            totalApps: 1,
            approved: 1,
            pending: 1,
            appliedVoters: { $size: '$voterIds' }
          }
        },
        { $sort: { totalApps: -1 } },
        { $limit: 100 }
      ], { allowDiskUse: true }),

      SchemeApplication.aggregate([
        { $match: scopeQuery },
        { $group: { _id: '$schemeName', count: { $sum: 1 }, cluster: { $first: '$clusterName' } } },
        { $sort: { count: -1 } }
      ], { allowDiskUse: true }),

      // Global referral counts grouped by referrer code (NOT scoped by the
      // referred person's location). Scoping to the referrer's own jurisdiction
      // is applied afterwards so a referrer shows up in THEIR district/assembly/
      // booth dashboard even when they refer people elsewhere.
      User.aggregate([
        { $match: { referredBy: { $nin: [null, '', 'null', 'undefined'] } } },
        { $group: { _id: '$referredBy', referralCount: { $sum: 1 } } }
      ], { allowDiskUse: true })
    ]);

    const statusMap = {
      Submitted: 0,
      Pending: 0,
      Called: 0,
      'In Progress': 0,
      Verified: 0,
      Approved: 0,
      Rejected: 0
    };
    statusCounts.forEach(item => {
      if (item._id) statusMap[item._id] = item.count;
    });

    const districtStats = await Promise.all(
      rawDistrictStats.map(async (d) => {
        const rollCount = await getDistrictVoterRollCount(d._id);
        return {
          _id: d._id,
          totalVoters: rollCount || null,
          appliedVoters: d.appliedVoters || 0,
          totalApps: d.totalApps,
          approved: d.approved,
          pending: d.pending
        };
      })
    );

    const assemblyStats = await Promise.all(
      rawAssemblyStats.map(async (a) => {
        const rollCount = await getAssemblyVoterRollCount(a._id.assemblyName);
        return {
          _id: a._id,
          totalVoters: rollCount || null,
          appliedVoters: a.appliedVoters || 0,
          totalApps: a.totalApps,
          approved: a.approved,
          pending: a.pending
        };
      })
    );

    const boothStats = await Promise.all(
      rawBoothStats.map(async (b) => {
        let rollCount = null;
        if (b._id.assemblyName && b._id.boothNo) {
          rollCount = await getBoothVoterRollCount(b._id.assemblyName, b._id.boothNo);
        }
        return {
          _id: b._id,
          totalVoters: rollCount,
          appliedVoters: b.appliedVoters || 0,
          totalApps: b.totalApps,
          approved: b.approved,
        };
      })
    );

    const CANONICAL_SCHEMES = BJP_SCHEMES.map(s => ({
      id: String(s.id),
      name: s.name,
      keys: s.keys || [s.name.toLowerCase()],
      cluster: s.cluster
    }));

    const popularityObj = {};
    // Pre-populate all 23 schemes with count 0 so every scheme is dynamically visible
    CANONICAL_SCHEMES.forEach(s => {
      popularityObj[s.name] = { _id: s.name, count: 0, cluster: s.cluster };
    });

    rawPopularity.forEach(item => {
      const rawStr = String(item._id || '').trim().toLowerCase();
      let matched = CANONICAL_SCHEMES.find(s => String(s.id) === String(item._id) || s.name.toLowerCase() === rawStr);
      if (!matched) {
        matched = CANONICAL_SCHEMES.find(s => s.keys.some(k => rawStr.includes(k)));
      }

      const displayName = matched ? matched.name : String(item._id);
      const clusterName = matched ? matched.cluster : (item.cluster || 'BJP Nalam Thittam Welfare');

      if (!popularityObj[displayName]) {
        popularityObj[displayName] = { _id: displayName, count: 0, cluster: clusterName };
      }
      popularityObj[displayName].count += item.count;
    });

    const schemePopularity = Object.values(popularityObj).sort((a, b) => b.count - a.count);

    // ── Rank Top Referrers by the REFERRER's OWN jurisdiction ──
    // A referral is credited to the referrer regardless of where the referred
    // member lives. We keep only referrers who belong to this admin's scope.
    const countByCode = {};
    topReferrersRaw.forEach((r) => {
      if (r._id != null) countByCode[String(r._id).trim().toUpperCase()] = r.referralCount;
    });

    const referrerCodeList = topReferrersRaw.map((r) => r._id).filter(Boolean);

    let rankedReferrers = [];
    if (referrerCodeList.length > 0) {
      // Only load users who are actual referrers AND fall within this admin's scope.
      const scopedReferrerUsers = await User.find({
        ...scopeQuery,
        $or: [
          { referralCode: { $in: referrerCodeList } },
          { epicNo: { $in: referrerCodeList } },
          { mobile: { $in: referrerCodeList } }
        ]
      }).select('referralCode epicNo mobile voterName district assemblyName boothNo');

      rankedReferrers = scopedReferrerUsers
        .map((u) => {
          const cnt =
            countByCode[String(u.referralCode || '').trim().toUpperCase()] ||
            countByCode[String(u.epicNo || '').trim().toUpperCase()] ||
            countByCode[String(u.mobile || '').trim().toUpperCase()] ||
            0;
          return { user: u, referralCount: cnt };
        })
        .filter((x) => x.referralCount > 0)
        .sort((a, b) => b.referralCount - a.referralCount)
        .slice(0, 5);
    }

    // Compute L2 network counts for all top referrers in 2 bulk queries — no N+1
    const topReferrerCodes = rankedReferrers.map(r => r.user.referralCode).filter(Boolean);
    const networkCountMap = {};
    if (topReferrerCodes.length > 0) {
      const l1Users = await User.find({ referredBy: { $in: topReferrerCodes } })
        .select('referralCode referredBy').lean();
      const l1Codes = l1Users.map(u => u.referralCode).filter(Boolean);
      if (l1Codes.length > 0) {
        const l2Raw = await User.aggregate([
          { $match: { referredBy: { $in: l1Codes } } },
          { $group: { _id: '$referredBy', count: { $sum: 1 } } }
        ]);
        const l2ByL1Code = {};
        l2Raw.forEach(r => { if (r._id) l2ByL1Code[r._id] = r.count; });
        // Map L2 counts back up to each top referrer
        l1Users.forEach(l1 => {
          const topCode = l1.referredBy;
          if (topCode && l1.referralCode) {
            networkCountMap[topCode] = (networkCountMap[topCode] || 0) + (l2ByL1Code[l1.referralCode] || 0);
          }
        });
      }
    }

    const topReferrers = rankedReferrers.map(({ user: referrerUser, referralCount }) => ({
      epicNo: referrerUser.epicNo,
      voterName: referrerUser.voterName,
      mobile: referrerUser.mobile,
      district: referrerUser.district,
      assemblyName: referrerUser.assemblyName,
      boothNo: referrerUser.boothNo,
      referralCode: referrerUser.referralCode,
      referralCount,
      networkCount: referralCount + (networkCountMap[referrerUser.referralCode] || 0)
    }));

    const payload = {
      success: true,
      adminRole: admin.role,
      jurisdiction: {
        district: admin.district,
        assemblyName: admin.assemblyName,
        boothNo: admin.boothNo
      },
      overview: {
        totalUsers: totalVotersRequested,
        totalVotersRequested,
        totalRegisteredUsers,
        totalVotersInRoll,
        totalApplications,
        statusBreakdown: statusMap,
        pendingVolunteers,
        totalVolunteers,
        totalIncomplete
      },
      districtStats,
      assemblyStats,
      boothStats,
      schemePopularity,
      topReferrers
    };
    _statsCache.set(_cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[getDashboardStats Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to compute dashboard stats' });
  }
};

// @desc    Get Referred Members by Member (EPIC or Referral Code)
// @route   GET /api/admin/member-referrals
// @access  Private (Admin)
const getMemberReferrals = async (req, res) => {
  try {
    const { epicNo, referralCode, mobile, userId } = req.query;

    let targetUser = null;
    if (userId) targetUser = await User.findById(userId);
    if (!targetUser && epicNo) targetUser = await User.findOne({ epicNo: epicNo.trim().toUpperCase() });
    if (!targetUser && mobile) targetUser = await User.findOne({ mobile: mobile.trim() });
    if (!targetUser && referralCode) targetUser = await User.findOne({ referralCode: referralCode.trim() });

    const searchCodes = [];
    if (targetUser) {
      if (targetUser.referralCode) searchCodes.push(targetUser.referralCode);
      if (targetUser.epicNo) searchCodes.push(targetUser.epicNo);
      if (targetUser.mobile) searchCodes.push(targetUser.mobile);
    }
    if (referralCode) searchCodes.push(referralCode);
    if (epicNo) searchCodes.push(epicNo);
    if (mobile) searchCodes.push(mobile);

    const uniqueCodes = Array.from(new Set(searchCodes.filter(Boolean)));
    if (uniqueCodes.length === 0) {
      return res.status(200).json({ success: true, count: 0, referredVoters: [] });
    }

    // Scope returned referred members to this admin's own jurisdiction.
    // SUPER_ADMIN and STATE_ADMIN see all; lower roles see only their area.
    const jurisdictionFilter = getAdminScopeQuery(req.admin);

    const referredUsers = await User.find({
      ...jurisdictionFilter,
      referredBy: { $in: uniqueCodes }
    }).select('_id epicNo voterName mobile district assemblyName boothNo referralCode')
      .sort({ createdAt: -1 })
      .lean();

    // Fetch L2 counts in ONE bulk aggregation — no N+1
    const l1Codes = referredUsers.map(u => u.referralCode).filter(Boolean);
    const l2CountMap = {};
    if (l1Codes.length > 0) {
      const l2Raw = await User.aggregate([
        { $match: { referredBy: { $in: l1Codes } } },
        { $group: { _id: '$referredBy', count: { $sum: 1 } } }
      ]);
      l2Raw.forEach(r => { if (r._id) l2CountMap[r._id] = r.count; });
    }

    // Fetch scheme application counts per referred user — ONE bulk aggregation
    const userIds = referredUsers.map(u => u._id);
    const appCountMap = {};
    if (userIds.length > 0) {
      const appRaw = await SchemeApplication.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ]);
      appRaw.forEach(r => { if (r._id) appCountMap[String(r._id)] = r.count; });
    }

    const referredVoters = referredUsers.map(u => ({
      id: u._id,
      epicNo: u.epicNo,
      voterName: u.voterName,
      mobile: u.mobile,
      district: u.district,
      assemblyName: u.assemblyName,
      boothNo: u.boothNo,
      referralCode: u.referralCode,
      level2Count: l2CountMap[u.referralCode] || 0,
      applicationCount: appCountMap[String(u._id)] || 0
    }));

    return res.status(200).json({
      success: true,
      count: referredVoters.length,
      referredVoters
    });
  } catch (error) {
    console.error('[getMemberReferrals Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get Scoped Applications List for Admin (Paginated by Voter)
// @route   GET /api/admin/applications
const getApplicationsList = async (req, res) => {
  try {
    const admin = req.admin;
    const { search, status, schemeName, district, assemblyName, boothNo, page = 1, limit = 20, exportAll } = req.query;
    const isExport = req.query.isExport === 'true' || exportAll === 'true';
    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = isExport ? 500000 : Math.min(500, Math.max(1, parseInt(limit) || 20));
    const skip = isExport ? 0 : (pageNum - 1) * limitNum;

    // ── Build Scope Filter for SchemeApplications ──
    const adminScope = getAdminScopeQuery(admin);
    const appScopeFilter = { ...adminScope };

    const isValidFilterVal = (val) => val && val !== 'undefined' && val !== 'null' && val !== 'all' && String(val).trim() !== '';

    if (isValidFilterVal(district))     appScopeFilter.district     = new RegExp('^' + escapeRegex(toDbDistrict(district)) + '$', 'i');
    if (isValidFilterVal(assemblyName)) appScopeFilter.assemblyName = new RegExp('^' + escapeRegex(assemblyName.trim()) + '$', 'i');
    if (isValidFilterVal(boothNo))      appScopeFilter.boothNo      = String(boothNo).trim();
    if (isValidFilterVal(status))       appScopeFilter.status       = new RegExp('^' + escapeRegex(status.trim()) + '$', 'i');

    const targetScheme = schemeName || req.query.scheme || req.query.schemeId;
    if (isValidFilterVal(targetScheme)) {
      const clean = String(targetScheme).trim();
      let matchedScheme = BJP_SCHEMES.find(s =>
        String(s.id) === clean ||
        s.name.toLowerCase() === clean.toLowerCase() ||
        (s.fullName && s.fullName.toLowerCase() === clean.toLowerCase()) ||
        clean.toLowerCase().includes(s.name.toLowerCase())
      );

      const regexes = [new RegExp('^' + clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')];
      if (matchedScheme) {
        regexes.push(new RegExp('^' + matchedScheme.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
        // Applications are often stored with schemeName = the numeric scheme id
        // (the chatbot submits scheme ids). Match that too, otherwise filtering
        // by the human-readable name returns nothing.
        regexes.push(new RegExp('^' + String(matchedScheme.id) + '$'));
        if (matchedScheme.fullName) {
          regexes.push(new RegExp(matchedScheme.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        }
        if (matchedScheme.keys && Array.isArray(matchedScheme.keys)) {
          matchedScheme.keys.forEach(k => {
            regexes.push(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
          });
        }
      } else {
        regexes.push(new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }

      // Match either the schemeName (by any regex above) or the numeric schemeId.
      if (matchedScheme) {
        const schemeCond = { $or: [{ schemeName: { $in: regexes } }, { schemeId: Number(matchedScheme.id) }] };
        appScopeFilter.$and = [...(appScopeFilter.$and || []), schemeCond];
      } else {
        appScopeFilter.schemeName = { $in: regexes };
      }
    }

    if (search) {
      const r = new RegExp(escapeRegex(search.trim()), 'i');
      const searchConds = [{ voterName: r }, { epicNo: r }, { mobile: r }, { schemeName: r }];
      if (appScopeFilter.$or) {
        const existingOr = appScopeFilter.$or;
        delete appScopeFilter.$or;
        appScopeFilter.$and = [{ $or: existingOr }, { $or: searchConds }];
      } else {
        appScopeFilter.$or = searchConds;
      }
    }

    // ── Fast Path: Two-step voter-based pagination (avoids MongoDB 32MB sort limit) ──
    if (!isExport) {
      const voterSkip = (pageNum - 1) * limitNum;

      // Step 1: Lightweight aggregation by mobile number — only mobile + latestAt (tiny memory, no $$ROOT)
      // Run in parallel with counts and status breakdown
      const [totalAppsCount, distinctMobileCount, statusGroup, epicPage] = await Promise.all([
        SchemeApplication.countDocuments(appScopeFilter),
        SchemeApplication.aggregate([
          { $match: appScopeFilter },
          { $group: { _id: '$mobile' } },
          { $count: 'total' }
        ], { allowDiskUse: true }).then(r => r[0]?.total || 0),
        SchemeApplication.aggregate([
          { $match: appScopeFilter },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ], { allowDiskUse: true }),
        SchemeApplication.aggregate([
          { $match: appScopeFilter },
          // Group by voter mobile number — only keep the tiny fields needed for sorting + identity
          {
            $group: {
              _id:      { $ifNull: ['$mobile', { $ifNull: ['$epicNo', { $toString: '$userId' }] }] },
              mobile:   { $first: '$mobile' },
              epicNo:   { $first: '$epicNo' },
              latestAt: { $max: '$appliedAt' }
            }
          },
          { $sort: { latestAt: -1 } },
          { $skip:  voterSkip },
          { $limit: limitNum },
          { $project: { _id: 1, mobile: 1, epicNo: 1 } }
        ], { allowDiskUse: true })
      ]);

      const distinctVoterCount = distinctMobileCount || totalAppsCount;
      const totalPages = Math.ceil(distinctVoterCount / limitNum) || 1;

      const statusCounts = { Approved: 0, Pending: 0, Submitted: 0, Processing: 0, Called: 0, Verified: 0, Completed: 0, Rejected: 0 };
      statusGroup.forEach(g => { if (g._id) statusCounts[g._id] = g.count; });

      // Step 2: Fetch full application docs for just these 20 voter Mobiles/EPICs
      const pageMobiles  = epicPage.map(e => e.mobile).filter(Boolean);
      const pageEpicNos  = epicPage.map(e => e.epicNo).filter(Boolean);
      const pageVoterIds = epicPage.map(e => e._id).filter(id => id && !pageMobiles.includes(id) && !pageEpicNos.includes(id));

      const rawApps = await SchemeApplication.find({
        $and: [
          appScopeFilter,
          { $or: [
            { mobile: { $in: pageMobiles } },
            { epicNo: { $in: pageEpicNos } },
            { userId: { $in: pageVoterIds } }
          ]}
        ]
      }).sort({ appliedAt: -1 }).lean();

      // Group apps by voter mobile key
      const voterMap = {};
      // Preserve the sorted order from epicPage
      epicPage.forEach(e => { voterMap[e._id] = null; });

      rawApps.forEach(app => {
        const key = app.mobile || app.epicNo || (app.userId ? String(app.userId) : null);
        if (!key) return;
        if (!voterMap[key]) {
          voterMap[key] = {
            _id:          app.userId || key,
            epicNo:       app.epicNo || 'N/A',
            voterName:    app.voterName || 'N/A',
            mobile:       app.mobile || 'N/A',
            district:     app.district || 'N/A',
            assemblyName: app.assemblyName || 'N/A',
            boothNo:      app.boothNo || 'N/A',
            userId:       app.userId,
            referralCode: app.referralCode,
            applications: []
          };
        }
        voterMap[key].applications.push(app);
      });

      // Return voters in the same order as epicPage (latest first)
      let voters = epicPage
        .map(e => voterMap[e._id])
        .filter(Boolean);

      // ── Enrich missing voter names from the voter roll DB (read DB) ──
      // Detect any bad/placeholder voter name — always enrich from voter DB if name looks fake
      const PLACEHOLDER_NAMES = new Set([
        null, undefined, '', 'N/A', 'n/a', 'null', 'undefined',
        'voter', 'Voter', 'VOTER',
        'user', 'User', 'USER',
        'member', 'Member', 'MEMBER',
        'name', 'Name', 'NAME',
        'unknown', 'Unknown', 'UNKNOWN',
        'test', 'Test', 'TEST'
      ]);
      const isBadName = (name) => !name || PLACEHOLDER_NAMES.has(name) || String(name).trim().length < 2;
      const needsEnrichment = voters.filter(v => isBadName(v.voterName) && v.epicNo && v.epicNo !== 'N/A');

      if (needsEnrichment.length > 0) {
        try {
          const voterDb = await getVoterDbClient();
          const { getCollectionForAssembly } = require('../services/jurisdictionService');

          // Group by assemblyName to minimize DB queries (1 query per unique assembly)
          const byAssembly = {};
          needsEnrichment.forEach(v => {
            const key = v.assemblyName || '__unknown__';
            if (!byAssembly[key]) byAssembly[key] = [];
            byAssembly[key].push(v.epicNo);
          });

          const epicNameMap = {};

          await Promise.all(
            Object.entries(byAssembly).map(async ([assName, epicNos]) => {
              try {
                let colNames = assName !== '__unknown__' ? await getCollectionForAssembly(assName) : [];
                // Fallback: scan all collections if assembly not found
                if (!colNames.length) {
                  const allCols = await voterDb.listCollections().toArray();
                  colNames = allCols.filter(c => c.name.startsWith('ass_')).map(c => c.name);
                }
                for (const colName of colNames) {
                  const found = await voterDb.collection(colName).find(
                    { EPIC_NO: { $in: epicNos } },
                    { projection: { EPIC_NO: 1, VOTER_NAME: 1, _id: 0 } }
                  ).toArray();
                  found.forEach(doc => {
                    if (doc.EPIC_NO && doc.VOTER_NAME) epicNameMap[doc.EPIC_NO] = doc.VOTER_NAME;
                  });
                  if (epicNos.every(e => epicNameMap[e])) break;
                }
              } catch (e) { /* non-fatal */ }
            })
          );

          // Patch names into voters array
          voters = voters.map(v => {
            if (isBadName(v.voterName) && v.epicNo && epicNameMap[v.epicNo]) {
              return { ...v, voterName: epicNameMap[v.epicNo] };
            }
            return v;
          });
        } catch (enrichErr) {
          console.error('[Name Enrichment Error]:', enrichErr.message);
          // Non-fatal — continue with what we have
        }
      }

      // referralCode and referredBy live on User, not SchemeApplication — patch in bulk.
      const fastMobiles = voters.map(v => v.mobile).filter(m => m && m !== 'N/A');
      if (fastMobiles.length > 0) {
        const fastUserDocs = await User.find({ mobile: { $in: fastMobiles } })
          .select('mobile referralCode referredBy').lean();
        const fastRefMap = {};
        const fastRefByMap = {};
        fastUserDocs.forEach(u => {
          if (u.mobile) {
            fastRefMap[u.mobile]   = u.referralCode || '';
            fastRefByMap[u.mobile] = u.referredBy   || '';
          }
        });
        voters = voters.map(v => ({
          ...v,
          referralCode: fastRefMap[v.mobile]   || v.referralCode || '',
          referredBy:   fastRefByMap[v.mobile] || ''
        }));
      }

      return res.status(200).json({
        success: true,
        voters,
        totalApplications: totalAppsCount,
        totalVoters: distinctVoterCount,
        statusCounts,
        totalPages,
        currentPage: pageNum,
        limit: limitNum,
        applications: voters.flatMap(v => v.applications)
      });
    }

    // ── Aggregate distinct applicants for complete export ──
    const applicantAgg = await SchemeApplication.aggregate([
      { $match: appScopeFilter },
      {
        $group: {
          _id: { $ifNull: ['$mobile', { $ifNull: ['$epicNo', '$userId'] }] },
          epicNo: { $first: '$epicNo' },
          voterName: { $first: '$voterName' },
          mobile: { $first: '$mobile' },
          district: { $first: '$district' },
          assemblyName: { $first: '$assemblyName' },
          boothNo: { $first: '$boothNo' },
          userId: { $first: '$userId' },
          referralCode: { $first: '$referralCode' },
          latestAppliedAt: { $max: '$appliedAt' }
        }
      }
    ], { allowDiskUse: true });

    const totalVoters = applicantAgg.length;
    const totalPages  = Math.ceil(totalVoters / limitNum) || 1;
    const paginatedApplicants = applicantAgg;

    if (paginatedApplicants.length === 0) {
      return res.status(200).json({ success: true, voters: [], totalVoters, totalPages, currentPage: pageNum, limit: limitNum, applications: [] });
    }

    const paginatedUserIds = paginatedApplicants.map(a => a.userId).filter(Boolean);
    const paginatedEpicNos = paginatedApplicants.map(a => a.epicNo).filter(Boolean);
    const paginatedMobiles = paginatedApplicants.map(a => a.mobile).filter(Boolean);

    const allApps = await SchemeApplication.find({
      $or: [
        { userId: { $in: paginatedUserIds } },
        { epicNo: { $in: paginatedEpicNos } },
        { mobile: { $in: paginatedMobiles } }
      ]
    }).lean();

    allApps.sort((a, b) => new Date(b.appliedAt || b.createdAt) - new Date(a.appliedAt || a.createdAt));

    const appMapByEpic = {};
    const appMapByUserId = {};
    const appMapByMobile = {};

    allApps.forEach(app => {
      if (app.epicNo) {
        if (!appMapByEpic[app.epicNo]) appMapByEpic[app.epicNo] = [];
        appMapByEpic[app.epicNo].push(app);
      }
      if (app.userId) {
        const uid = String(app.userId);
        if (!appMapByUserId[uid]) appMapByUserId[uid] = [];
        appMapByUserId[uid].push(app);
      }
      if (app.mobile) {
        if (!appMapByMobile[app.mobile]) appMapByMobile[app.mobile] = [];
        appMapByMobile[app.mobile].push(app);
      }
    });

    // referralCode and referredBy live on User, not SchemeApplication — fetch in bulk.
    const mobileList = paginatedApplicants.map(a => a.mobile).filter(Boolean);
    const userRefMap   = {};
    const userRefByMap = {};
    if (mobileList.length > 0) {
      const userDocs = await User.find({ mobile: { $in: mobileList } })
        .select('mobile referralCode referredBy').lean();
      userDocs.forEach(u => {
        if (u.mobile) {
          userRefMap[u.mobile]   = u.referralCode || '';
          userRefByMap[u.mobile] = u.referredBy   || '';
        }
      });
    }

    const voters = paginatedApplicants.map(u => {
      const userAppMap = new Map();
      if (u.epicNo && appMapByEpic[u.epicNo]) {
        appMapByEpic[u.epicNo].forEach(a => userAppMap.set(String(a._id), a));
      }
      if (u.userId && appMapByUserId[String(u.userId)]) {
        appMapByUserId[String(u.userId)].forEach(a => userAppMap.set(String(a._id), a));
      }
      if (u.mobile && appMapByMobile[u.mobile]) {
        appMapByMobile[u.mobile].forEach(a => userAppMap.set(String(a._id), a));
      }

      const apps = Array.from(userAppMap.values()).sort((a, b) => new Date(b.appliedAt || b.createdAt) - new Date(a.appliedAt || a.createdAt));

      return {
        id: u._id,
        epicNo: u.epicNo,
        voterName: u.voterName,
        mobile: u.mobile,
        district: u.district,
        assemblyName: u.assemblyName,
        boothNo: u.boothNo,
        referralCode: userRefMap[u.mobile]   || u.referralCode || '',
        referredBy:   userRefByMap[u.mobile] || '',
        applications: apps
      };
    });

    return res.status(200).json({
      success:      true,
      voters,
      totalVoters,
      totalPages,
      currentPage:  pageNum,
      limit:        limitNum,
      applications: voters.flatMap(v => v.applications)
    });
  } catch (error) {
    console.error('[getApplicationsList Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


// @desc    Update Scheme Application Status & Remarks
// @route   PUT /api/admin/applications/:id/status
// @access  Private (Admin)
const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, isCallAction } = req.body;

    const scopeFilter = getAdminScopeQuery(req.admin);
    const app = await SchemeApplication.findOne({ _id: id, ...scopeFilter });
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application record not found' });
    }

    if (status) {
      app.status = status;
    }
    if (remarks !== undefined) {
      app.adminRemarks = remarks;
    }
    if (isCallAction) {
      app.lastCalledAt = new Date();
      if (!status) app.status = 'Called';
    }

    app.statusHistory.push({
      status: app.status,
      remarks: remarks || (isCallAction ? 'Call logged by admin' : 'Status updated'),
      updatedBy: `${req.admin.role} (${req.admin.username})`,
      updatedAt: new Date()
    });

    await app.save();
    invalidateStatsCache(); // stats changed — drop cached dashboard aggregates

    return res.status(200).json({
      success: true,
      message: 'Application status updated successfully',
      application: app
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Create new Admin Credential
// @route   POST /api/admin/create-credential
// @access  Private (Super Admin or State Admin)
const createAdminCredential = async (req, res) => {
  try {
    const { username, password, role, district, assemblyName, boothNo } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ success: false, message: 'Username, password, and role are required' });
    }

    const existing = await Admin.findOne({ username: username.trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: `Admin username '${username}' already exists.` });
    }

    const newAdmin = await Admin.create({
      username: username.trim(),
      password: password.trim(),
      role,
      district: district ? district.trim() : null,
      assemblyName: assemblyName ? assemblyName.trim() : null,
      boothNo: boothNo ? String(boothNo).trim() : null,
      createdBy: `${req.admin.role} (${req.admin.username})`
    });

    return res.status(201).json({
      success: true,
      message: `Created ${role} account '${newAdmin.username}' successfully`,
      admin: {
        id: newAdmin._id,
        username: newAdmin.username,
        role: newAdmin.role,
        district: newAdmin.district,
        assemblyName: newAdmin.assemblyName,
        boothNo: newAdmin.boothNo
      }
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get List of All Custom Admin Accounts
// @route   GET /api/admin/credentials
// @access  Private (Admin - Super / State)
const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: admins.length,
      admins
    });
  } catch (error) {
    console.error('[Admin API Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get filter metadata (assemblies in scope + booths for a given assembly)
// @route   GET /api/admin/filter-meta?assemblyName=xxx
// @access  Private (Admin)
const getFilterMeta = async (req, res) => {
  try {
    const admin = req.admin;
    const { district, assemblyName } = req.query;
    const scopeQuery = getAdminScopeQuery(admin);

    if (assemblyName) {
      // Return sorted booth numbers for the given assembly
      const boothQuery = { ...scopeQuery, assemblyName: new RegExp('^' + escapeRegex(assemblyName.trim()) + '$', 'i') };
      if (district) boothQuery.district = new RegExp('^' + escapeRegex(district.trim()) + '$', 'i');
      const rawBooths = await SchemeApplication.distinct('boothNo', boothQuery);
      const booths = rawBooths.filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));
      return res.status(200).json({ success: true, booths });
    }

    if (district) {
      // Return assemblies and booths in the selected district
      const distQuery = { ...scopeQuery, district: new RegExp('^' + escapeRegex(district.trim()) + '$', 'i') };
      const [assemblies, rawBooths] = await Promise.all([
        SchemeApplication.distinct('assemblyName', distQuery),
        SchemeApplication.distinct('boothNo', distQuery)
      ]);
      assemblies.sort((a, b) => a.localeCompare(b));
      const booths = rawBooths.filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));
      return res.status(200).json({ success: true, assemblies, booths });
    }

    // Return all districts, assemblies, and booths in scope
    const [districts, assemblies, rawBooths] = await Promise.all([
      SchemeApplication.distinct('district', scopeQuery),
      SchemeApplication.distinct('assemblyName', scopeQuery),
      SchemeApplication.distinct('boothNo', scopeQuery)
    ]);
    districts.sort((a, b) => a.localeCompare(b));
    assemblies.sort((a, b) => a.localeCompare(b));
    const booths = rawBooths.filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));

    return res.status(200).json({ success: true, districts, assemblies, booths });
  } catch (err) {
    console.error('[getFilterMeta Error]:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Stream CSV export of applications (server-side, fast)
// @route   GET /api/admin/export-csv
// @access  Private (Admin)
const exportApplicationsCsv = async (req, res) => {
  try {
    const { district, assemblyName, boothNo, status, schemeName, search, format } = req.query;
    const admin = req.admin;

    // ── Build scope filter (same as getApplicationsList) ──
    const appScopeFilter = { ...getAdminScopeQuery(admin) };
    const isValidFilterVal = (val) => val && val !== 'undefined' && val !== 'null' && val !== 'all' && String(val).trim() !== '';
    if (isValidFilterVal(district))     appScopeFilter.district     = new RegExp('^' + escapeRegex(toDbDistrict(district)) + '$', 'i');
    if (isValidFilterVal(assemblyName)) appScopeFilter.assemblyName = new RegExp('^' + escapeRegex(assemblyName.trim()) + '$', 'i');
    if (isValidFilterVal(boothNo))      appScopeFilter.boothNo      = String(boothNo).trim();
    if (isValidFilterVal(status))       appScopeFilter.status       = new RegExp('^' + escapeRegex(status.trim()) + '$', 'i');
    const targetScheme = schemeName || req.query.scheme || req.query.schemeId;
    if (isValidFilterVal(targetScheme)) {
      const clean = String(targetScheme).trim();
      let matchedScheme = BJP_SCHEMES.find(s =>
        String(s.id) === clean ||
        s.name.toLowerCase() === clean.toLowerCase() ||
        (s.fullName && s.fullName.toLowerCase() === clean.toLowerCase()) ||
        clean.toLowerCase().includes(s.name.toLowerCase())
      );
      const regexes = [new RegExp('^' + clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')];
      if (matchedScheme) {
        regexes.push(new RegExp('^' + matchedScheme.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
        if (matchedScheme.fullName) {
          regexes.push(new RegExp(matchedScheme.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        }
        if (matchedScheme.keys && Array.isArray(matchedScheme.keys)) {
          matchedScheme.keys.forEach(k => {
            regexes.push(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
          });
        }
      } else {
        regexes.push(new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }
      appScopeFilter.schemeName = { $in: regexes };
    }
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      appScopeFilter.$or = [{ voterName: re }, { epicNo: re }, { mobile: re }];
    }

    const scopeLabel = boothNo ? `Booth_${boothNo}` : assemblyName ? assemblyName.replace(/\s+/g, '_') : district ? district.replace(/\s+/g, '_') : 'Statewide';
    const timestamp  = new Date().toISOString().slice(0, 10);
    const filename   = `BJP_Report_${scopeLabel}_${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // UTF-8 BOM so Excel opens it correctly without encoding issues
    res.write('\uFEFF');

    // Header row
    const headers = ['S.No', 'Voter Name', 'EPIC Number', 'Mobile Number', 'District', 'Assembly Name', 'Booth No', 'Scheme Name', 'Cluster / Benefit', 'Status', 'Applied Date'];
    res.write(headers.map(h => `"${h}"`).join(',') + '\n');

    // Stream cursor — never loads all docs into memory
    const cursor = SchemeApplication.find(
      appScopeFilter,
      { voterName: 1, epicNo: 1, mobile: 1, district: 1, assemblyName: 1, boothNo: 1, schemeName: 1, schemeId: 1, clusterName: 1, status: 1, appliedAt: 1 }
    ).sort({ appliedAt: -1 }).lean().cursor();

    let idx = 0;
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

    for await (const doc of cursor) {
      idx++;
      const appliedDate = doc.appliedAt ? new Date(doc.appliedAt).toLocaleDateString('en-IN') : '—';
      const row = [
        idx,
        esc(doc.voterName),
        esc(doc.epicNo),
        esc(doc.mobile),
        esc(doc.district),
        esc(doc.assemblyName),
        esc(doc.boothNo),
        esc(resolveSchemeName(doc.schemeName, doc.schemeId)),
        esc(doc.clusterName),
        esc(doc.status),
        esc(appliedDate)
      ];
      res.write(row.join(',') + '\n');
    }

    res.end();
  } catch (error) {
    console.error('[exportApplicationsCsv Error]:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to export CSV' });
    } else {
      res.end();
    }
  }
};

// @desc  Export styled Excel file (server-side, fast streaming)
// @route GET /api/admin/export-excel
// @access Private
const exportApplicationsExcel = async (req, res) => {
  try {
    const {
      district, assemblyName, boothNo, status, schemeId,
      startDate, endDate, search
    } = req.query;
    const user = req.admin;

    // ── Build scope filter (same as CSV export) ──
    const appScopeFilter = { ...getAdminScopeQuery(user) };
    const isValidFilterVal = (val) => val && val !== 'undefined' && val !== 'null' && val !== 'all' && String(val).trim() !== '';
    if (isValidFilterVal(district))      appScopeFilter.district     = district;
    if (isValidFilterVal(assemblyName)) appScopeFilter.assemblyName  = assemblyName;
    if (isValidFilterVal(boothNo))      appScopeFilter.boothNo       = String(boothNo);
    if (isValidFilterVal(status))       appScopeFilter.status        = status;
    const targetSchemeExcel = req.query.schemeName || req.query.scheme || schemeId;
    if (isValidFilterVal(targetSchemeExcel)) {
      const clean = String(targetSchemeExcel).trim();
      let matchedScheme = BJP_SCHEMES.find(s =>
        String(s.id) === clean ||
        s.name.toLowerCase() === clean.toLowerCase() ||
        (s.fullName && s.fullName.toLowerCase() === clean.toLowerCase()) ||
        clean.toLowerCase().includes(s.name.toLowerCase())
      );
      const regexes = [new RegExp('^' + clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')];
      if (matchedScheme) {
        regexes.push(new RegExp('^' + matchedScheme.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
        if (matchedScheme.fullName) {
          regexes.push(new RegExp(matchedScheme.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        }
        if (matchedScheme.keys && Array.isArray(matchedScheme.keys)) {
          matchedScheme.keys.forEach(k => {
            regexes.push(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
          });
        }
      } else {
        regexes.push(new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }
      appScopeFilter.schemeName = { $in: regexes };
    }
    if (startDate || endDate) {
      appScopeFilter.appliedAt = {};
      if (startDate) appScopeFilter.appliedAt.$gte = new Date(startDate);
      if (endDate)   appScopeFilter.appliedAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }
    if (search) {
      const re = { $regex: escapeRegex(search), $options: 'i' };
      appScopeFilter.$or = [{ voterName: re }, { epicNo: re }, { mobile: re }];
    }

    // ── Status colour map ──
    const STATUS_COLORS = {
      Approved:   { bg: 'FF16a34a', fg: 'FFFFFFFF' },
      Completed:  { bg: 'FF15803d', fg: 'FFFFFFFF' },
      Rejected:   { bg: 'FFdc2626', fg: 'FFFFFFFF' },
      Submitted:  { bg: 'FF2563eb', fg: 'FFFFFFFF' },
      Pending:    { bg: 'FFf59e0b', fg: 'FFFFFFFF' },
      Processing: { bg: 'FF7c3aed', fg: 'FFFFFFFF' },
      Called:     { bg: 'FF0891b2', fg: 'FFFFFFFF' },
      Verified:   { bg: 'FF059669', fg: 'FFFFFFFF' },
    };

    // ── Create workbook ──
    const workbook  = new ExcelJS.Workbook();
    workbook.creator = 'BJP Nalam Thittam';
    const sheet = workbook.addWorksheet('Applications', {
      views: [{ state: 'frozen', ySplit: 5 }]
    });

    // Column definitions (key + width only; header row is written manually
    // below so we can place a title/scope/filter block above it).
    const COLUMNS = [
      { header: 'S.No',         key: 'sno',      width: 6  },
      { header: 'Voter Name',   key: 'name',     width: 25 },
      { header: 'EPIC Number',  key: 'epic',     width: 16 },
      { header: 'Mobile No',    key: 'mobile',   width: 14 },
      { header: 'District',     key: 'district', width: 18 },
      { header: 'Assembly',     key: 'assembly', width: 22 },
      { header: 'Booth No',     key: 'booth',    width: 9  },
      { header: 'Scheme Name',  key: 'scheme',   width: 32 },
      { header: 'Cluster',      key: 'cluster',  width: 45 },
      { header: 'Status',       key: 'status',   width: 13 },
      { header: 'Applied Date', key: 'date',       width: 14 },
      { header: 'Referred By',  key: 'referredBy', width: 16 },
    ];
    sheet.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));
    const LAST_COL = 'L'; // 12 columns → A..L

    // ── Scope label (based on the admin's role) ──
    let scopeLabel;
    if (user.role === 'DISTRICT_ADMIN')      scopeLabel = `District-wise Report — ${user.district || '—'}`;
    else if (user.role === 'ASSEMBLY_ADMIN') scopeLabel = `Assembly-wise Report — ${user.assemblyName || '—'}`;
    else if (user.role === 'BOOTH_ADMIN')    scopeLabel = `Booth-wise Report — Booth ${user.boothNo || '—'}${user.assemblyName ? ', ' + user.assemblyName : ''}`;
    else                                     scopeLabel = 'Statewide Report — All Tamil Nadu';

    // ── Filters applied at download time ──
    const filterParts = [];
    if (isValidFilterVal(status))            filterParts.push(`Status: ${status}`);
    if (isValidFilterVal(targetSchemeExcel)) filterParts.push(`Scheme: ${resolveSchemeName(targetSchemeExcel)}`);
    if (isValidFilterVal(district))          filterParts.push(`District: ${district}`);
    if (isValidFilterVal(assemblyName))      filterParts.push(`Assembly: ${assemblyName}`);
    if (isValidFilterVal(boothNo))           filterParts.push(`Booth: ${boothNo}`);
    if (isValidFilterVal(search))            filterParts.push(`Search: "${search}"`);
    if (startDate || endDate)                filterParts.push(`Date: ${startDate || '…'} to ${endDate || '…'}`);
    const filtersLabel = filterParts.length ? filterParts.join('    |    ') : 'None (all records in scope)';

    // ── Title block (rows 1–4) ──
    sheet.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'BJP Nalam Thittam — Scheme Applications Report';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFF6B00' }, name: 'Calibri' };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 26;

    sheet.mergeCells(`A2:${LAST_COL}2`);
    const scopeCell = sheet.getCell('A2');
    scopeCell.value = scopeLabel;
    scopeCell.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
    scopeCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(2).height = 20;

    sheet.mergeCells(`A3:${LAST_COL}3`);
    const filterCell = sheet.getCell('A3');
    filterCell.value = `Filters Applied:   ${filtersLabel}`;
    filterCell.font = { size: 11, italic: true, color: { argb: 'FF475569' } };
    filterCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(3).height = 18;

    sheet.mergeCells(`A4:${LAST_COL}4`);
    const genCell = sheet.getCell('A4');
    genCell.value = `Generated by ${user.username || user.role}  •  ${new Date().toLocaleString('en-IN')}`;
    genCell.font = { size: 10, color: { argb: 'FF94A3B8' } };
    genCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(4).height = 16;

    // ── Column header row (row 5) — saffron BJP orange ──
    const HEADER_ROW_NUM = 5;
    const headerRow = sheet.getRow(HEADER_ROW_NUM);
    COLUMNS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.eachCell(cell => {
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
      cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FFCC5500' } }
      };
    });
    headerRow.height = 22;

    // Fetch all matching docs (used for both Sheet 1 and Sheet 2)
    const allDocs = await SchemeApplication.find(appScopeFilter)
      .sort({ appliedAt: -1 })
      .select('voterName epicNo mobile district assemblyName boothNo schemeName clusterName status appliedAt')
      .lean();

    // Build mobile → referredBy map for the Referred By column
    const excelRefByMap = {};
    const excelMobiles = [...new Set(allDocs.map(d => d.mobile).filter(Boolean))];
    if (excelMobiles.length > 0) {
      const excelUserDocs = await User.find({ mobile: { $in: excelMobiles } })
        .select('mobile referredBy').lean();
      excelUserDocs.forEach(u => { if (u.mobile) excelRefByMap[u.mobile] = u.referredBy || ''; });
    }

    // ── Sheet 1: one row per application ──
    let idx = 0;
    for (const doc of allDocs) {
      idx++;
      const appliedDate = doc.appliedAt ? new Date(doc.appliedAt).toLocaleDateString('en-IN') : '—';
      const statusColors = STATUS_COLORS[doc.status] || { bg: 'FFe5e7eb', fg: 'FF374151' };

      const row = sheet.addRow({
        sno:        idx,
        name:       doc.voterName  || '—',
        epic:       doc.epicNo     || '—',
        mobile:     doc.mobile     || '—',
        district:   doc.district   || '—',
        assembly:   doc.assemblyName || '—',
        booth:      doc.boothNo    || '—',
        scheme:     resolveSchemeName(doc.schemeName, doc.schemeId),
        cluster:    doc.clusterName || '—',
        status:     doc.status     || '—',
        date:       appliedDate,
        referredBy: (doc.mobile && excelRefByMap[doc.mobile]) || '—',
      });

      // Alternate row banding
      const rowBg = idx % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF';
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.alignment = { vertical: 'middle', wrapText: false };
        if (colNum !== 10) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        }
      });

      // Mobile as text — prevent scientific notation
      const mobileCell = row.getCell('mobile');
      mobileCell.numFmt = '@';

      // Status cell — coloured pill
      const statusCell = row.getCell('status');
      statusCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColors.bg } };
      statusCell.font  = { bold: true, color: { argb: statusColors.fg }, size: 10 };
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    // ── Sheet 2: one row per person (By Person summary) ──
    const sheet2 = workbook.addWorksheet('By Person', {
      views: [{ state: 'frozen', ySplit: 5 }]
    });

    const S2_COLS = [
      { header: 'S.No',            key: 'sno',      width: 6  },
      { header: 'Voter Name',      key: 'name',     width: 25 },
      { header: 'EPIC Number',     key: 'epic',     width: 16 },
      { header: 'Mobile No',       key: 'mobile',   width: 14 },
      { header: 'District',        key: 'district', width: 18 },
      { header: 'Assembly',        key: 'assembly', width: 22 },
      { header: 'Schemes Applied', key: 'schemes',  width: 60 },
      { header: 'Total Schemes',   key: 'total',    width: 14 },
      { header: 'First Applied',   key: 'date',     width: 14 },
    ];
    const S2_LAST_COL = 'I';
    sheet2.columns = S2_COLS.map(c => ({ key: c.key, width: c.width }));

    // Title block
    sheet2.mergeCells(`A1:${S2_LAST_COL}1`);
    const s2Title = sheet2.getCell('A1');
    s2Title.value = 'BJP Nalam Thittam — Applicants Summary (By Person)';
    s2Title.font = { bold: true, size: 16, color: { argb: 'FFFF6B00' }, name: 'Calibri' };
    s2Title.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet2.getRow(1).height = 26;

    sheet2.mergeCells(`A2:${S2_LAST_COL}2`);
    const s2Scope = sheet2.getCell('A2');
    s2Scope.value = scopeLabel;
    s2Scope.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
    s2Scope.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet2.getRow(2).height = 20;

    sheet2.mergeCells(`A3:${S2_LAST_COL}3`);
    const s2Filter = sheet2.getCell('A3');
    s2Filter.value = `Filters Applied:   ${filtersLabel}`;
    s2Filter.font = { size: 11, italic: true, color: { argb: 'FF475569' } };
    s2Filter.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet2.getRow(3).height = 18;

    sheet2.mergeCells(`A4:${S2_LAST_COL}4`);
    const s2Gen = sheet2.getCell('A4');
    s2Gen.value = `Generated by ${user.username || user.role}  •  ${new Date().toLocaleString('en-IN')}`;
    s2Gen.font = { size: 10, color: { argb: 'FF94A3B8' } };
    s2Gen.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet2.getRow(4).height = 16;

    // Header row
    const s2Header = sheet2.getRow(5);
    S2_COLS.forEach((c, i) => { s2Header.getCell(i + 1).value = c.header; });
    s2Header.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFCC5500' } } };
    });
    s2Header.height = 22;

    // Group by epicNo
    const personMap = new Map();
    for (const doc of allDocs) {
      const key = doc.epicNo || doc.voterName;
      if (!personMap.has(key)) {
        personMap.set(key, {
          voterName:    doc.voterName || '—',
          epicNo:       doc.epicNo    || '—',
          mobile:       doc.mobile    || '—',
          district:     doc.district  || '—',
          assemblyName: doc.assemblyName || '—',
          schemes:      [],
          firstApplied: doc.appliedAt,
        });
      }
      const entry = personMap.get(key);
      const schemeName = resolveSchemeName(doc.schemeName, doc.schemeId);
      if (!entry.schemes.includes(schemeName)) entry.schemes.push(schemeName);
      if (doc.appliedAt && doc.appliedAt < entry.firstApplied) entry.firstApplied = doc.appliedAt;
    }

    // Sort by total schemes desc
    const persons = [...personMap.values()].sort((a, b) => b.schemes.length - a.schemes.length);

    let s2Idx = 0;
    for (const p of persons) {
      s2Idx++;
      const row = sheet2.addRow({
        sno:      s2Idx,
        name:     p.voterName,
        epic:     p.epicNo,
        mobile:   p.mobile,
        district: p.district,
        assembly: p.assemblyName,
        schemes:  p.schemes.join(', '),
        total:    p.schemes.length,
        date:     p.firstApplied ? new Date(p.firstApplied).toLocaleDateString('en-IN') : '—',
      });

      const rowBg = s2Idx % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF';
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
      row.getCell('mobile').numFmt = '@';
      row.getCell('total').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('total').font = { bold: true };
      row.height = Math.min(15 + p.schemes.length * 2, 60);
    }

    // Send as .xlsx download
    const filename = `BJP_Applications_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('[exportApplicationsExcel Error]:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export Excel' });
    else res.end();
  }
};

// @desc    Get Booth Voter Roll with Application Status & Color Coding
// @route   GET /api/admin/booth-voter-roll
// @access  Private (Admin)
const getBoothVoterRoll = async (req, res) => {
  try {
    const admin = req.admin;
    const {
      page = 1,
      limit = 20,
      search = '',
      statusCategory = '', // 'completed', 'in_progress' / 'applied', 'rejected', 'not_applied'
      boothNo: queryBoothNo,
      assemblyName: queryAssemblyName
    } = req.query;

    const targetBooth = queryBoothNo || admin.boothNo;
    const targetAssembly = queryAssemblyName || admin.assemblyName;

    if (!targetBooth || !targetAssembly) {
      return res.status(400).json({ success: false, message: 'Assembly name and booth number are required' });
    }

    const assemblies = await getAssemblyMetadata();
    const match = assemblies.find(a => a.assemblyName.toUpperCase() === targetAssembly.toUpperCase());
    if (!match) {
      return res.status(404).json({ success: false, message: `Assembly '${targetAssembly}' not found` });
    }

    const voterDb = await getVoterDbClient();
    const col = voterDb.collection(match.colName);

    const COMPLETED_STATUSES = new Set(['Completed', 'Verified', 'Approved']);
    const REJECTED_STATUSES = new Set(['Rejected']);

    // Fetch all scheme applications for this booth to compute category sets & summary stats
    const allBoothApps = await SchemeApplication.find({
      district: new RegExp('^' + escapeRegex(admin.district || match.district) + '$', 'i'),
      assemblyName: new RegExp('^' + escapeRegex(targetAssembly) + '$', 'i'),
      boothNo: String(targetBooth)
    }).select('epicNo status').lean();

    const boothAppEpicsMap = {};
    allBoothApps.forEach(a => {
      if (!boothAppEpicsMap[a.epicNo]) boothAppEpicsMap[a.epicNo] = [];
      boothAppEpicsMap[a.epicNo].push(a.status);
    });

    const completedEpics = [];
    const inProgressEpics = [];
    const rejectedEpics = [];
    const allAppliedEpics = Object.keys(boothAppEpicsMap);

    Object.entries(boothAppEpicsMap).forEach(([epic, statuses]) => {
      if (statuses.some(s => COMPLETED_STATUSES.has(s))) {
        completedEpics.push(epic);
      } else if (statuses.every(s => REJECTED_STATUSES.has(s))) {
        rejectedEpics.push(epic);
      } else {
        inProgressEpics.push(epic);
      }
    });

    // Build MongoDB filter query for voter roll collection
    const filter = { PART_NO: String(targetBooth) };

    if (search && search.trim() !== '') {
      const cleanSearch = escapeRegex(search.trim());
      filter.$or = [
        { EPIC_NO: new RegExp(cleanSearch, 'i') },
        { VOTER_NAME: new RegExp(cleanSearch, 'i') },
        { MOBILE: new RegExp(cleanSearch, 'i') }
      ];
    }

    // Apply status category filter if provided
    const cleanCategory = String(statusCategory || '').trim().toLowerCase();
    if (cleanCategory === 'completed') {
      filter.EPIC_NO = { $in: completedEpics };
    } else if (cleanCategory === 'in_progress' || cleanCategory === 'applied') {
      filter.EPIC_NO = { $in: inProgressEpics };
    } else if (cleanCategory === 'rejected') {
      filter.EPIC_NO = { $in: rejectedEpics };
    } else if (cleanCategory === 'not_applied') {
      filter.EPIC_NO = { $nin: allAppliedEpics };
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Total voter count in booth matching current filter
    const totalFilteredVoters = await col.countDocuments(filter);
    
    // Overall total voters in booth (unfiltered)
    const overallBoothVotersCount = await col.countDocuments({ PART_NO: String(targetBooth) });

    // Fetch page of voters
    const rawVoters = await col.find(filter)
      .sort({ SL_NO: 1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const epicNos = rawVoters.map(v => v.EPIC_NO).filter(Boolean);

    // Fetch matching SchemeApplications for current page
    const pageApplications = await SchemeApplication.find({
      epicNo: { $in: epicNos }
    }).sort({ appliedAt: -1 });

    const appMap = {};
    pageApplications.forEach(app => {
      if (!appMap[app.epicNo]) appMap[app.epicNo] = [];
      appMap[app.epicNo].push(app);
    });

    // Also fetch registered Users for mobile numbers
    const registeredUsers = await User.find({
      epicNo: { $in: epicNos }
    }).select('epicNo mobile');

    const userMobileMap = {};
    registeredUsers.forEach(u => {
      userMobileMap[u.epicNo] = u.mobile;
    });

    const formattedVoters = rawVoters.map((v, idx) => {
      const epic = v.EPIC_NO;
      const apps = appMap[epic] || [];
      const mobile = userMobileMap[epic] || v.MOBILE_NUMBER || v.MOBILE || '—';
      const rawHouse = v.HOUSE_NO || v.DOOR_NO || v.HOUSE_NUMBER || v.HOUSE_NMBR || v.SECTION_NO;
      const houseNo = rawHouse && String(rawHouse).trim() !== '' && String(rawHouse).trim() !== '-' 
        ? String(rawHouse).trim() 
        : `Booth ${v.PART_NO || targetBooth}`;
      const rawAge = parseInt(v.AGE);
      const age = (!isNaN(rawAge) && rawAge > 0) ? rawAge : 0;

      let cat = 'not_applied'; // gray
      let latestStatus = 'Not Applied';

      if (apps.length > 0) {
        const hasCompleted = apps.some(a => COMPLETED_STATUSES.has(a.status));
        const hasRejected = apps.some(a => REJECTED_STATUSES.has(a.status));

        if (hasCompleted) {
          cat = 'completed'; // green
          latestStatus = apps.find(a => COMPLETED_STATUSES.has(a.status))?.status || 'Approved';
        } else if (hasRejected && apps.every(a => REJECTED_STATUSES.has(a.status))) {
          cat = 'rejected'; // red
          latestStatus = 'Rejected';
        } else {
          cat = 'in_progress'; // blue
          latestStatus = apps[0]?.status || 'In Progress';
        }
      }

      return {
        slNo: v.SL_NO || String(skip + idx + 1),
        epicNo: epic,
        voterName: v.VOTER_NAME,
        fatherName: v.RELATION_NAME || v.FATHER_NAME || '—',
        houseNo,
        gender: v.GENDER || 'Unspecified',
        age,
        mobile,
        partNo: v.PART_NO || String(targetBooth),
        applicationsCount: apps.length,
        applications: apps.map(a => ({
          id: a._id,
          schemeName: a.schemeName,
          status: a.status,
          appliedAt: a.appliedAt
        })),
        statusCategory: cat,
        latestStatus
      };
    });

    const notAppliedCount = Math.max(0, overallBoothVotersCount - allAppliedEpics.length);

    return res.status(200).json({
      success: true,
      boothNo: String(targetBooth),
      assemblyName: targetAssembly,
      district: match.district,
      totalVoters: totalFilteredVoters,
      page: pageNum,
      totalPages: Math.ceil(totalFilteredVoters / limitNum) || 1,
      voters: formattedVoters,
      summaryStats: {
        totalVoters: overallBoothVotersCount,
        completedCount: completedEpics.length,
        inProgressCount: inProgressEpics.length,
        rejectedCount: rejectedEpics.length,
        notAppliedCount
      }
    });
  } catch (error) {
    console.error('[getBoothVoterRoll Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch booth voter roll' });
  }
};

// ── Map Analytics ──────────────────────────────────────────────────────────
// Lightweight endpoint for the admin map views. Returns district-level and
// assembly-level application counts, scoped to the logged-in admin's jurisdiction.
// Does not include referral data, booth details, or voter roll counts — keeps
// response fast for map rendering.
const getMapAnalytics = async (req, res) => {
  try {
    const admin = req.admin;
    const cacheKey = JSON.stringify({ role: admin.role, district: admin.district || null, assembly: admin.assemblyName || null });
    const cached = _mapCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MAP_CACHE_TTL_MS) {
      return res.status(200).json(cached.data);
    }

    const scopeQuery = getAdminScopeQuery(admin);

    const [districtStats, assemblyStats] = await Promise.all([
      SchemeApplication.aggregate([
        { $match: scopeQuery },
        {
          $group: {
            _id: '$district',
            total: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', ['Submitted', 'Pending', 'In Progress', 'Called']] }, 1, 0] } }
          }
        },
        { $sort: { total: -1 } }
      ], { allowDiskUse: true }),

      SchemeApplication.aggregate([
        { $match: scopeQuery },
        {
          $group: {
            _id: { district: '$district', assembly: '$assemblyName' },
            total: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', ['Submitted', 'Pending', 'In Progress', 'Called']] }, 1, 0] } }
          }
        },
        { $sort: { total: -1 } }
      ], { allowDiskUse: true })
    ]);

    const payload = {
      success: true,
      role: admin.role,
      district: admin.district || null,
      assemblyName: admin.assemblyName || null,
      districtStats,
      assemblyStats
    };
    _mapCache.set(cacheKey, { data: payload, ts: Date.now() });
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[getMapAnalytics Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch map analytics' });
  }
};

// @desc    Assembly / booth coverage (registered vs voter roll) scoped to admin
// @route   GET /api/admin/coverage
// @access  Private (Admin)
const getCoverage = async (req, res) => {
  try {
    const admin = req.admin;
    const _cKey = scopeCacheKey(admin);
    const _cCached = _coverageCache.get(_cKey);
    if (_cCached && Date.now() - _cCached.at < COVERAGE_TTL_MS) return res.status(200).json(_cCached.payload);

    const isBoothLevel = (admin.role === 'ASSEMBLY_ADMIN' || admin.role === 'BOOTH_ADMIN');

    if (isBoothLevel) {
      const asmName = admin.assemblyName;
      if (!asmName) return res.status(400).json({ success: false, message: 'Assembly not set' });

      const [regByBooth, cols] = await Promise.all([
        SchemeApplication.aggregate([
          { $match: { assemblyName: new RegExp('^' + escapeRegex(asmName) + '$', 'i') } },
          { $group: { _id: '$boothNo', count: { $sum: 1 } } }
        ], { allowDiskUse: true }),
        getCollectionForAssembly(asmName)
      ]);

      const regMap = {};
      regByBooth.forEach(r => { if (r._id) regMap[String(r._id)] = r.count; });

      let rollMap = {};
      if (cols && cols.length > 0) {
        const voterDb = await getVoterDbClient();
        const counts = await voterDb.collection(cols[0]).aggregate([
          { $group: { _id: '$PART_NO', roll: { $sum: 1 } } }
        ], { allowDiskUse: true }).toArray();
        counts.forEach(c => { if (c._id) rollMap[String(c._id)] = c.roll; });
      }

      const allBooths = new Set([...Object.keys(regMap), ...Object.keys(rollMap)]);
      let rows = [...allBooths].map(boothNo => {
        const registered = regMap[boothNo] || 0;
        const roll = rollMap[boothNo] || 0;
        const pct = roll > 0 ? parseFloat(((registered / roll) * 100).toFixed(1)) : null;
        return { boothNo, registered, roll, pct };
      }).sort((a, b) => parseInt(a.boothNo) - parseInt(b.boothNo));

      if (admin.role === 'BOOTH_ADMIN') {
        rows = rows.filter(r => String(r.boothNo) === String(admin.boothNo));
      }

      const boothPayload = { success: true, type: 'booth', assemblyName: asmName, rows };
      _coverageCache.set(_cKey, { at: Date.now(), payload: boothPayload });
      return res.status(200).json(boothPayload);
    } else {
      const scopeQuery = getAdminScopeQuery(admin);

      const [regByAssembly, assemblies, voterCountMap] = await Promise.all([
        SchemeApplication.aggregate([
          { $match: scopeQuery },
          { $group: { _id: '$assemblyName', count: { $sum: 1 } } }
        ], { allowDiskUse: true }),
        getAssemblyMetadata(),
        getAllAssemblyVoterCounts()
      ]);

      const regMap = {};
      regByAssembly.forEach(r => { if (r._id) regMap[r._id.toUpperCase()] = r.count; });

      let filtered = assemblies;
      if (admin.role === 'DISTRICT_ADMIN' && admin.district) {
        filtered = assemblies.filter(a => a.district.toUpperCase() === admin.district.toUpperCase());
      }

      const rows = filtered.map(a => {
        const registered = regMap[a.assemblyName.toUpperCase()] || 0;
        const roll = voterCountMap[a.assemblyName.toUpperCase()] || 0;
        const pct = roll > 0 ? parseFloat(((registered / roll) * 100).toFixed(1)) : null;
        return { assemblyNo: a.assemblyNo, assemblyName: a.assemblyName, district: a.district, registered, roll, pct };
      });

      rows.sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1)); // lowest coverage first
      const assemblyPayload = { success: true, type: 'assembly', rows };
      _coverageCache.set(_cKey, { at: Date.now(), payload: assemblyPayload });
      return res.status(200).json(assemblyPayload);
    }
  } catch (err) {
    console.error('[getCoverage Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch coverage data' });
  }
};

// @desc    14-day daily registration trend (scoped to admin jurisdiction)
// @route   GET /api/admin/trends?days=14
// @access  Private (Admin)
const getTrends = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 14, 90);
    const _tKey = scopeCacheKey(req.admin) + ':' + days;
    const _tCached = _trendsCache.get(_tKey);
    if (_tCached && Date.now() - _tCached.at < TRENDS_TTL_MS) return res.status(200).json(_tCached.payload);

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const now = new Date();

    // Start of (days-1) ago in IST
    const sinceRaw = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const sinceIST = new Date(
      Math.floor((sinceRaw.getTime() + IST_OFFSET_MS) / 86400000) * 86400000 - IST_OFFSET_MS
    );

    const scopeQuery = getAdminScopeQuery(req.admin);

    const raw = await SchemeApplication.aggregate([
      { $match: { ...scopeQuery, appliedAt: { $gte: sinceIST } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$appliedAt', timezone: '+05:30' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ], { allowDiskUse: true });

    const map = {};
    raw.forEach(r => { map[r._id] = r.count; });

    const trends = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const ist = new Date(d.getTime() + IST_OFFSET_MS);
      const dateStr = ist.toISOString().slice(0, 10);
      trends.push({ date: dateStr, count: map[dateStr] || 0 });
    }

    const payload = { success: true, trends };
    _trendsCache.set(_tKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[getTrends Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch trends' });
  }
};

// @desc    Bulk update status of multiple applications (within admin scope)
// @route   PUT /api/admin/applications/bulk-status
// @access  Private (Admin)
const bulkUpdateApplicationStatus = async (req, res) => {
  try {
    const { ids, status, remarks } = req.body;
    const admin = req.admin;

    const VALID_STATUSES = ['Pending', 'Submitted', 'Processing', 'Completed', 'In Progress', 'Called', 'Verified', 'Approved', 'Rejected'];
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array is required and must not be empty' });
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    if (ids.length > 200) {
      return res.status(400).json({ success: false, message: 'Cannot bulk-update more than 200 applications at once' });
    }

    // Build scope filter so admins can only update within their own scope
    const scopeFilter = getAdminScopeQuery(admin);
    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));

    // Fetch only apps that are in scope (security check)
    const apps = await SchemeApplication.find({ _id: { $in: objectIds }, ...scopeFilter });

    if (apps.length === 0) {
      return res.status(403).json({ success: false, message: 'No applications found within your scope' });
    }

    const updatedBy = `${admin.role} (${admin.username})`;
    const now = new Date();
    const historyEntry = {
      status,
      remarks: remarks || `Bulk status update by ${updatedBy}`,
      updatedBy,
      updatedAt: now
    };

    // Use bulkWrite for efficiency
    const bulkOps = apps.map(app => ({
      updateOne: {
        filter: { _id: app._id },
        update: {
          $set: { status, adminRemarks: remarks || app.adminRemarks },
          $push: { statusHistory: historyEntry }
        }
      }
    }));

    const result = await SchemeApplication.bulkWrite(bulkOps);
    invalidateStatsCache();

    return res.status(200).json({
      success: true,
      message: `Updated ${result.modifiedCount} application(s) to "${status}"`,
      modifiedCount: result.modifiedCount,
      requestedCount: ids.length,
      skippedCount: ids.length - apps.length
    });
  } catch (error) {
    console.error('[bulkUpdateApplicationStatus Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Pre-warm stats cache for Super Admin scope so first dashboard load is instant.
// Runs the real handler, so the cached payload is identical to a live request
// (booth voter totals, top referrers, normalised scheme names) and the booth
// voter counts for the booth table are loaded as a side effect.
// getDashboardStats only reads req.admin and req.query — keep this stub in sync.
const warmStatsCache = async () => {
  try {
    const superAdmin = { role: 'SUPER_ADMIN', district: '', assemblyName: '', boothNo: '' };
    let statusCode = 0;
    let body = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; }
    };
    await getDashboardStats({ admin: superAdmin, query: {} }, res);
    if (statusCode !== 200 || !body?.success) {
      throw new Error(body?.message || `dashboard stats returned ${statusCode}`);
    }
    const booths = body.boothStats || [];
    console.log(`[Warmup] ✅ Stats cache warmed for Super Admin scope — booth rows: ${booths.length}, with voter totals: ${booths.filter(b => b.totalVoters).length}, top referrers: ${(body.topReferrers || []).length}`);
  } catch (err) {
    console.error('[Warmup] ❌ Stats cache warmup failed:', err.message);
  }
};

const warmCoverageCache = async () => {
  try {
    const superAdmin = { role: 'SUPER_ADMIN', district: '', assemblyName: '', boothNo: '' };
    const _cKey = scopeCacheKey(superAdmin);
    const [regByAssembly, assemblies, voterCountMap] = await Promise.all([
      SchemeApplication.aggregate([{ $match: {} }, { $group: { _id: '$assemblyName', count: { $sum: 1 } } }], { allowDiskUse: true }),
      getAssemblyMetadata(),
      getAllAssemblyVoterCounts()
    ]);
    const regMap = {};
    regByAssembly.forEach(r => { if (r._id) regMap[r._id.toUpperCase()] = r.count; });
    const rows = assemblies.map(a => {
      const registered = regMap[a.assemblyName.toUpperCase()] || 0;
      const roll = voterCountMap[a.assemblyName.toUpperCase()] || 0;
      const pct = roll > 0 ? parseFloat(((registered / roll) * 100).toFixed(1)) : null;
      return { assemblyNo: a.assemblyNo, assemblyName: a.assemblyName, district: a.district, registered, roll, pct };
    });
    rows.sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1));
    const payload = { success: true, type: 'assembly', rows };
    _coverageCache.set(_cKey, { at: Date.now(), payload });
    console.log('[Warmup] ✅ Coverage cache warmed for Super Admin scope');
  } catch (err) {
    console.error('[Warmup] ❌ Coverage cache warmup failed:', err.message);
  }
};

// @desc    Permanently delete a member + all their scheme applications (SUPER_ADMIN only)
// @route   DELETE /api/admin/members/:userId
const deleteMember = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ success: false, message: 'Member not found' });

    await SchemeApplication.deleteMany({ userId });
    await User.findByIdAndDelete(userId);
    invalidateStatsCache();

    return res.status(200).json({ success: true, message: `Member ${user.voterName} and all their applications deleted.` });
  } catch (err) {
    console.error('[deleteMember Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete member' });
  }
};

// @desc    Get scheme suggestions submitted by users (Super Admin only)
// @route   GET /api/admin/scheme-suggestions
// @access  Private (SUPER_ADMIN)
const getSchemeSuggestions = async (req, res) => {
  try {
    const [total, topRequests, byDistrict, recent] = await Promise.all([
      SchemeSuggestion.countDocuments(),

      SchemeSuggestion.aggregate([
        { $group: { _id: '$suggestion', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, suggestion: '$_id', count: 1 } }
      ]),

      SchemeSuggestion.aggregate([
        { $match: { district: { $nin: [null, ''] } } },
        { $group: { _id: '$district', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, district: '$_id', count: 1 } }
      ]),

      SchemeSuggestion.find()
        .sort({ createdAt: -1 })
        .limit(30)
        .select('suggestion voterName district assemblyName createdAt')
        .lean()
    ]);

    return res.status(200).json({ success: true, total, topRequests, byDistrict, recent });
  } catch (error) {
    console.error('[getSchemeSuggestions Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load scheme suggestions' });
  }
};

// @desc    List people who verified OTP but never completed registration
// @route   GET /api/admin/incomplete-registrations
// @access  SUPER_ADMIN, STATE_ADMIN
const getIncompleteRegistrations = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const stageFilter = req.query.stage;
    const searchRaw = (req.query.search || '').trim();

    const query = {};
    if (stageFilter && ['OTP_VERIFIED', 'EPIC_VERIFIED'].includes(stageFilter)) {
      query.stage = stageFilter;
    }
    if (searchRaw) {
      const safe = escapeRegex(searchRaw);
      query.$or = [
        { mobile: new RegExp(safe, 'i') },
        { epicNo: new RegExp(safe, 'i') },
        { voterName: new RegExp(safe, 'i') },
        { district: new RegExp(safe, 'i') }
      ];
    }

    const [total, records] = await Promise.all([
      IncompleteRegistration.countDocuments(query),
      IncompleteRegistration.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      records
    });
  } catch (error) {
    console.error('[getIncompleteRegistrations Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch incomplete registrations' });
  }
};

const exportAnalyticsExcel = async (req, res) => {
  return res.status(501).json({ success: false, message: 'Analytics export not yet implemented' });
};

const exportVolunteerRequestsExcel = async (req, res) => {
  try {
    const { status, district, assemblyName } = req.query;
    const user = req.admin;

    const isValid = (v) => v && v !== 'undefined' && v !== 'null' && v !== 'all' && String(v).trim() !== '';
    const isGlobalAdmin = user.role === 'SUPER_ADMIN' || user.role === 'STATE_ADMIN';
    const jurisdiction = getAdminScopeQuery(user);
    // A scoped admin whose own area is missing must not fall back to statewide data.
    if (!isGlobalAdmin && Object.keys(jurisdiction).length === 0) {
      return res.status(403).json({ success: false, message: 'Not allowed to export volunteer requests outside your area' });
    }
    // Requested filters can only narrow the admin's own area, never replace it.
    const requested = {};
    // Match every stored spelling of the district (e.g. VILLUPURAM + VILUPPURAM).
    if (isValid(district))      requested.district     = districtSpellingsFilter(district, await BoothPresidentRequest.distinct('district'));
    if (isValid(assemblyName))  requested.assemblyName = assemblyName;
    if (isValid(status))        requested.status       = status;
    const scopeFilter = { $and: [jurisdiction, requested] };

    const STATUS_COLORS = {
      Approved: { bg: 'FF16a34a', fg: 'FFFFFFFF' },
      Rejected: { bg: 'FFdc2626', fg: 'FFFFFFFF' },
      Pending:  { bg: 'FFf59e0b', fg: 'FFFFFFFF' },
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BJP Nalam Thittam';
    const sheet = workbook.addWorksheet('Volunteer Requests', {
      views: [{ state: 'frozen', ySplit: 5 }]
    });

    const COLUMNS = [
      { header: 'S.No',            key: 'sno',       width: 6  },
      { header: 'Voter Name',      key: 'name',      width: 26 },
      { header: 'EPIC No',         key: 'epic',      width: 16 },
      { header: 'Mobile',          key: 'mobile',    width: 14 },
      { header: 'Gender',          key: 'gender',    width: 10 },
      { header: 'District',        key: 'district',  width: 18 },
      { header: 'Assembly',        key: 'assembly',  width: 22 },
      { header: 'Booth No',        key: 'booth',     width: 9  },
      { header: 'Status',          key: 'status',    width: 12 },
      { header: 'Applied Date',    key: 'appliedAt', width: 16 },
      { header: 'Action Date',     key: 'actionDate',width: 16 },
      { header: 'Action By',       key: 'actionBy',  width: 16 },
      { header: 'Rejection Reason',key: 'reason',    width: 30 },
    ];
    sheet.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));
    const LAST_COL = 'M';

    let scopeLabel;
    if (user.role === 'DISTRICT_ADMIN')      scopeLabel = `District-wise Report — ${user.district || '—'}`;
    else if (user.role === 'ASSEMBLY_ADMIN') scopeLabel = `Assembly-wise Report — ${user.assemblyName || '—'}`;
    else                                     scopeLabel = 'Statewide Report — All Tamil Nadu';

    const filterParts = [];
    if (isValid(status))       filterParts.push(`Status: ${status}`);
    if (isValid(district))     filterParts.push(`District: ${district}`);
    if (isValid(assemblyName)) filterParts.push(`Assembly: ${assemblyName}`);
    const filtersLabel = filterParts.length ? filterParts.join('    |    ') : 'None (all records in scope)';

    sheet.mergeCells(`A1:${LAST_COL}1`);
    const t1 = sheet.getCell('A1');
    t1.value = 'BJP Nalam Thittam — Volunteer Requests Report';
    t1.font = { bold: true, size: 16, color: { argb: 'FFFF6B00' }, name: 'Calibri' };
    t1.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 26;

    sheet.mergeCells(`A2:${LAST_COL}2`);
    const t2 = sheet.getCell('A2');
    t2.value = scopeLabel;
    t2.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
    t2.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(2).height = 20;

    sheet.mergeCells(`A3:${LAST_COL}3`);
    const t3 = sheet.getCell('A3');
    t3.value = `Filters Applied:   ${filtersLabel}`;
    t3.font = { size: 11, italic: true, color: { argb: 'FF475569' } };
    t3.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(3).height = 18;

    sheet.mergeCells(`A4:${LAST_COL}4`);
    const t4 = sheet.getCell('A4');
    t4.value = `Generated by ${user.username || user.role}  •  ${new Date().toLocaleString('en-IN')}`;
    t4.font = { size: 10, color: { argb: 'FF94A3B8' } };
    t4.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(4).height = 16;

    const headerRow = sheet.getRow(5);
    COLUMNS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.eachCell(cell => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border    = { bottom: { style: 'medium', color: { argb: 'FFCC5500' } } };
    });
    headerRow.height = 22;

    const docs = await BoothPresidentRequest.find(scopeFilter)
      .sort({ appliedAt: -1 })
      .select('voterName epicNo mobile gender district assemblyName boothNo status appliedAt actionDate actionBy rejectionReason')
      .lean();

    let idx = 0;
    for (const doc of docs) {
      idx++;
      const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
      const sc = STATUS_COLORS[doc.status] || { bg: 'FFe5e7eb', fg: 'FF374151' };

      const row = sheet.addRow({
        sno:       idx,
        name:      doc.voterName    || '—',
        epic:      doc.epicNo       || '—',
        mobile:    doc.mobile       || '—',
        gender:    doc.gender       || '—',
        district:  doc.district     || '—',
        assembly:  doc.assemblyName || '—',
        booth:     doc.boothNo      || '—',
        status:    doc.status       || '—',
        appliedAt: fmt(doc.appliedAt),
        actionDate:fmt(doc.actionDate),
        actionBy:  doc.actionBy     || '—',
        reason:    doc.rejectionReason || '—',
      });

      const rowBg = idx % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF';
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.alignment = { vertical: 'middle', wrapText: false };
        if (colNum !== 9) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        }
      });

      row.getCell('mobile').numFmt = '@';

      const statusCell = row.getCell('status');
      statusCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.bg } };
      statusCell.font      = { bold: true, color: { argb: sc.fg }, size: 10 };
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    const distLabel = isValid(district) ? `_${district.replace(/\s+/g, '_')}` : '';
    const dateLabel = new Date().toISOString().slice(0, 10);
    const filename  = `Volunteer_Requests${distLabel}_${dateLabel}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('[exportVolunteerRequestsExcel Error]:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export volunteer requests' });
    else res.end();
  }
};

module.exports = {
  adminLogin,
  warmStatsCache,
  warmCoverageCache,
  getAssembliesList,
  getDistrictCredentials,
  getAssemblyCredentials,
  getAssemblyBoothCredentials,
  getDashboardStats,
  getMemberReferrals,
  getApplicationsList,
  exportApplicationsCsv,
  exportApplicationsExcel,
  exportAnalyticsExcel,
  exportVolunteerRequestsExcel,
  getFilterMeta,
  updateApplicationStatus,
  bulkUpdateApplicationStatus,
  createAdminCredential,
  getAllAdmins,
  getBoothVoterRoll,
  getMapAnalytics,
  getTrends,
  getCoverage,
  deleteMember,
  getSchemeSuggestions,
  getIncompleteRegistrations,
  invalidateStatsCache
};
