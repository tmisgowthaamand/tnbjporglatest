const BoothPresidentRequest = require('../models/BoothPresidentRequest');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');
const IncompleteRegistration = require('../models/IncompleteRegistration');
const jwt = require('jsonwebtoken');
const { getAssemblyMetadata } = require('../services/jurisdictionService');
const { invalidateStatsCache } = require('./adminController');
const { districtSpellingsFilter } = require('../utils/districtNormalizer');

const generateVolunteerToken = (id, tokenVersion = 1) =>
  jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, { expiresIn: '7d' });

// @desc    Apply to be a Volunteer
// @route   POST /api/booth-president/apply
const applyBoothPresident = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Check existing request
    let existing = await BoothPresidentRequest.findOne({ userId: user._id });

    if (existing) {
      if (existing.status === 'Approved') {
        return res.status(400).json({
          success: false,
          message: 'You are already an approved volunteer.',
          request: existing
        });
      }

      // Re-apply: update existing pending/rejected record
      existing.type = 'volunteer';
      existing.voterName = user.voterName;
      existing.epicNo = user.epicNo;
      existing.mobile = user.mobile;
      existing.gender = user.gender || 'Unspecified';
      existing.district = user.district || '';
      existing.assemblyName = user.assemblyName || '';
      existing.assemblyNo = user.assemblyNo || '';
      existing.boothNo = '';
      existing.isCustomBooth = false;
      existing.originalDistrict = '';
      existing.originalAssembly = '';
      existing.originalBoothNo = '';
      existing.status = 'Pending';
      existing.rejectionReason = '';
      existing.appliedAt = new Date();
      existing.actionDate = null;
      existing.actionBy = '';

      await existing.save();

      return res.status(200).json({
        success: true,
        message: 'Your volunteer application has been submitted successfully!',
        request: existing
      });
    }

    const newRequest = await BoothPresidentRequest.create({
      type: 'volunteer',
      userId: user._id,
      voterName: user.voterName,
      epicNo: user.epicNo,
      mobile: user.mobile,
      gender: user.gender || 'Unspecified',
      district: user.district || '',
      assemblyName: user.assemblyName || '',
      assemblyNo: user.assemblyNo || '',
      boothNo: '',
      isCustomBooth: false,
      status: 'Pending',
      appliedAt: new Date()
    });

    return res.status(201).json({
      success: true,
      message: 'Your volunteer application has been submitted successfully!',
      request: newRequest
    });
  } catch (error) {
    console.error('[applyVolunteer Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit volunteer application' });
  }
};

// @desc    Get current user's Booth President application status
// @route   GET /api/booth-president/my-status
const getMyBoothPresidentStatus = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const request = await BoothPresidentRequest.findOne({ userId: user._id });

    return res.status(200).json({
      success: true,
      hasApplied: !!request,
      request: request || null
    });
  } catch (error) {
    console.error('[getMyBoothPresidentStatus Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get public list of districts, assemblies & booths for custom selection
// @route   GET /api/booth-president/jurisdictions
const getPublicJurisdictions = async (req, res) => {
  try {
    const metadata = await getAssemblyMetadata();

    const districtSet = new Set();
    const assemblies = [];

    (metadata || []).forEach(item => {
      if (item.district) districtSet.add(item.district);
      assemblies.push({
        district: item.district,
        assemblyNo: item.assemblyNo,
        assemblyName: item.assemblyName,
        label: item.label
      });
    });

    const districts = Array.from(districtSet).sort();

    return res.status(200).json({
      success: true,
      districts,
      assemblies
    });
  } catch (error) {
    console.error('[getPublicJurisdictions Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch jurisdiction data' });
  }
};

// @desc    Get Booth President requests for Admin Dashboards
// @route   GET /api/admin/booth-president-requests
const getAdminBoothPresidentRequests = async (req, res) => {
  try {
    const admin = req.admin;
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const { page = 1, limit = 20, status, search, district, assemblyName } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    // Apply role-based jurisdiction filter. Only SUPER/STATE admins see all of
    // Tamil Nadu; every other role is limited to its own area, and an unknown
    // role or a scoped admin missing its area sees nothing.
    const exact = (v) => new RegExp(`^${String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (admin.role === 'ASSEMBLY_ADMIN' && admin.assemblyName) {
      filter.assemblyName = exact(admin.assemblyName);
    } else if (admin.role === 'DISTRICT_ADMIN' && admin.district) {
      filter.district = exact(admin.district);
    } else if (admin.role === 'BOOTH_ADMIN' && admin.assemblyName && admin.boothNo) {
      if (admin.district) filter.district = exact(admin.district);
      filter.assemblyName = exact(admin.assemblyName);
      filter.boothNo = String(admin.boothNo).trim();
    } else if (admin.role !== 'SUPER_ADMIN' && admin.role !== 'STATE_ADMIN') {
      return res.status(403).json({ success: false, message: 'Not allowed to view volunteer requests outside your area' });
    } else {
      // Match every stored spelling of the district (e.g. VILLUPURAM + VILUPPURAM).
      if (district) filter.district = districtSpellingsFilter(district, await BoothPresidentRequest.distinct('district'));
      if (assemblyName) filter.assemblyName = new RegExp(`^${assemblyName.trim()}$`, 'i');
    }

    if (status) {
      filter.status = status;
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { voterName: regex },
        { epicNo: regex },
        { mobile: regex },
        { boothNo: regex }
      ];
    }

    const [requests, totalRequests, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      BoothPresidentRequest.find(filter)
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      BoothPresidentRequest.countDocuments(filter),
      BoothPresidentRequest.countDocuments({ ...filter, status: 'Pending' }),
      BoothPresidentRequest.countDocuments({ ...filter, status: 'Approved' }),
      BoothPresidentRequest.countDocuments({ ...filter, status: 'Rejected' })
    ]);

    const totalPages = Math.ceil(totalRequests / limitNum) || 1;

    return res.status(200).json({
      success: true,
      requests,
      totalRequests,
      totalPages,
      currentPage: pageNum,
      stats: {
        total: totalRequests,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      }
    });
  } catch (error) {
    console.error('[getAdminBoothPresidentRequests Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch Booth President requests' });
  }
};

// @desc    Approve or Reject a Volunteer Request — Super Admin only
// @route   POST /api/admin/booth-president-requests/:id/action
const handleBoothPresidentAction = async (req, res) => {
  try {
    const admin = req.admin;
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    if (admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can approve or reject volunteer requests' });
    }

    const { id } = req.params;
    const { action, reason } = req.body;

    if (!['Approved', 'Rejected'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be Approved or Rejected' });
    }

    const request = await BoothPresidentRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Volunteer request not found' });
    }

    request.status = action;
    request.rejectionReason = action === 'Rejected' ? (reason || 'Application declined by admin') : '';
    request.actionDate = new Date();
    request.actionBy = admin.username || admin.role;

    await request.save();
    invalidateStatsCache();

    return res.status(200).json({
      success: true,
      message: `Volunteer application ${action} successfully!`,
      request
    });
  } catch (error) {
    console.error('[handleVolunteerAction Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to process volunteer request' });
  }
};

// @desc    Direct volunteer registration (no login required — OTP session auth)
// @route   POST /api/booth-president/volunteer-register
const volunteerRegister = async (req, res) => {
  try {
    const {
      mobile, epicNo, epic_no, voterName, name,
      district, assemblyName, assembly, boothNo, part_no, gender, assemblyNo
    } = req.body;

    const cleanMobile = (mobile || '').trim();
    const cleanEpic = ((epicNo || epic_no || '').trim()).toUpperCase();
    const cleanName = (voterName || name || '').trim();
    const cleanDistrict = (district || '').trim();
    const cleanAss = (assemblyName || assembly || '').trim();
    const cleanBooth = (boothNo || part_no || '').toString().trim();
    const cleanAssNo = (assemblyNo || '').toString().trim();

    if (!cleanMobile) {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    // Auth: accept existing user JWT or a fresh verified OTP session
    const authHeader = req.headers.authorization || '';
    let tokenUser = null;
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        tokenUser = await User.findById(decoded.id);
      } catch (_) {}
    }
    if (!tokenUser) {
      const verifiedSession = await OtpSession.findOne({ mobile: cleanMobile, verified: true });
      if (!verifiedSession) {
        return res.status(401).json({ success: false, message: 'Please verify your mobile number via OTP first.' });
      }
    }

    // Find or create User record
    let user = tokenUser || (await User.findOne({ mobile: cleanMobile }));

    if (!user) {
      let ntCode;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = 'NT-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const exists = await User.exists({ referralCode: candidate });
        if (!exists) { ntCode = candidate; break; }
      }
      if (!ntCode) throw new Error('Failed to generate unique referral code');

      user = await User.create({
        mobile: cleanMobile,
        epicNo: cleanEpic || ('PND-' + cleanMobile),
        voterName: cleanName || 'Volunteer',
        district: cleanDistrict || 'Tamil Nadu',
        assemblyName: cleanAss || 'Assembly',
        boothNo: cleanBooth || '0',
        gender: gender || 'Unspecified',
        assemblyNo: cleanAssNo,
        referralCode: ntCode,
        referredBy: null
      });
    }

    // Create or update BoothPresidentRequest
    let request = await BoothPresidentRequest.findOne({ userId: user._id });

    if (request) {
      if (request.status === 'Approved') {
        return res.status(400).json({ success: false, message: 'You are already an approved volunteer.', request });
      }
      request.type = 'volunteer';
      request.voterName = user.voterName;
      request.epicNo = user.epicNo;
      request.mobile = user.mobile;
      request.gender = user.gender || 'Unspecified';
      request.district = user.district || '';
      request.assemblyName = user.assemblyName || '';
      request.assemblyNo = user.assemblyNo || '';
      request.boothNo = '';
      request.isCustomBooth = false;
      request.status = 'Pending';
      request.rejectionReason = '';
      request.appliedAt = new Date();
      request.actionDate = null;
      request.actionBy = '';
      await request.save();
    } else {
      request = await BoothPresidentRequest.create({
        type: 'volunteer',
        userId: user._id,
        voterName: user.voterName,
        epicNo: user.epicNo,
        mobile: user.mobile,
        gender: user.gender || 'Unspecified',
        district: user.district || '',
        assemblyName: user.assemblyName || '',
        assemblyNo: user.assemblyNo || '',
        boothNo: '',
        isCustomBooth: false,
        status: 'Pending',
        appliedAt: new Date()
      });
    }

    // Cleanup incomplete registration record (fire-and-forget)
    IncompleteRegistration.deleteOne({ mobile: cleanMobile }).catch(() => {});

    const token = generateVolunteerToken(user._id, user.tokenVersion || 1);

    return res.status(201).json({
      success: true,
      message: 'Volunteer application submitted successfully!',
      token,
      user: {
        _id: user._id,
        voterName: user.voterName,
        epicNo: user.epicNo,
        mobile: user.mobile,
        referralCode: user.referralCode
      },
      request
    });
  } catch (error) {
    console.error('[volunteerRegister Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit volunteer application' });
  }
};

// @desc    Volunteer request counts per district, split by status (Tamil Nadu map)
// @route   GET /api/admin/volunteer-map
// @access  SUPER_ADMIN, STATE_ADMIN
const getVolunteerMap = async (req, res) => {
  try {
    const rows = await BoothPresidentRequest.aggregate([
      {
        $group: {
          _id: '$district',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'Rejected'] }, 1, 0] } }
        }
      },
      { $sort: { total: -1 } }
    ]);
    const totals = rows.reduce((t, r) => ({
      total: t.total + r.total,
      pending: t.pending + r.pending,
      approved: t.approved + r.approved,
      rejected: t.rejected + r.rejected
    }), { total: 0, pending: 0, approved: 0, rejected: 0 });
    return res.status(200).json({ success: true, districtStats: rows, totals });
  } catch (error) {
    console.error('[getVolunteerMap Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch volunteer map' });
  }
};

module.exports = {
  applyBoothPresident,
  getMyBoothPresidentStatus,
  getPublicJurisdictions,
  getAdminBoothPresidentRequests,
  handleBoothPresidentAction,
  volunteerRegister,
  getVolunteerMap
};
