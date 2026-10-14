const User = require('../models/User');
const OtpSession = require('../models/OtpSession');
const SchemeApplication = require('../models/SchemeApplication');
const IncompleteRegistration = require('../models/IncompleteRegistration');
const { getVoterDbClient } = require('../config/db');
const { sendSmsOtp } = require('../services/smsService');
const { findVoterByEpic } = require('../services/voterSearchService');
const jwt = require('jsonwebtoken');

const generateToken = (id, tokenVersion = 1) => {
  return jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// @desc    Send OTP to mobile
// @route   POST /api/send-otp
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile.trim())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit mobile number' });
    }

    const cleanMobile = mobile.trim();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    // Per-mobile cooldown — must run BEFORE deleteMany (which would clear the session).
    // Blocks re-requests within 60s regardless of IP, protecting 2Factor SMS credits.
    const recentSession = await OtpSession.findOne({
      mobile: cleanMobile,
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) }
    });
    if (recentSession) {
      return res.status(429).json({
        success: false,
        message: 'OTP already sent. Please wait 60 seconds before requesting again.'
      });
    }

    // Run the user lookup and old-session cleanup together (both local DB ops).
    const [existingUser] = await Promise.all([
      User.findOne({ mobile: cleanMobile }),
      OtpSession.deleteMany({ mobile: cleanMobile })
    ]);

    // Persist the OTP session BEFORE responding so verification is ready
    // immediately. (verifyOtp matches on mobile + otp, not sessionId.)
    const session = await OtpSession.create({
      mobile: cleanMobile,
      otp,
      sessionId: null,
      expiresAt
    });

    // Respond right away — the SMS gateway call is the slow part, so we
    // dispatch it in the background instead of making the user wait for the
    // 2Factor round-trip. The OTP already works the moment this returns.
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      mobile: cleanMobile,
      isExistingUser: !!existingUser,
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp })
    });

    // Fire-and-forget SMS dispatch (does not block the response).
    sendSmsOtp(cleanMobile, otp)
      .then((smsResult) => {
        if (smsResult?.sessionId) {
          OtpSession.updateOne({ _id: session._id }, { sessionId: smsResult.sessionId }).catch(() => {});
        }
      })
      .catch((err) => console.error('[sendOtp background SMS Error]:', err.message));
  } catch (error) {
    console.error('[sendOtp Error]:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
  }
};

// @desc    Verify OTP
// @route   POST /api/verify-otp
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'Mobile number and OTP are required' });
    }

    const cleanMobile = mobile.trim();
    const cleanOtp = otp.trim();

    // Static dev-bypass OTP is ONLY honoured outside production. In production
    // (NODE_ENV=production) there is no bypass — a real, matching OTP session
    // is always required.
    const allowDevBypass = process.env.NODE_ENV !== 'production';
    const isDevBypass = allowDevBypass && cleanOtp === '123456';

    const session = await OtpSession.findOne({ mobile: cleanMobile, verified: false });

    if (!session && !isDevBypass) {
      return res.status(400).json({ success: false, message: 'OTP session expired. Please request a new OTP.' });
    }

    // Authoritative expiry check — don't rely solely on the TTL index (whose
    // sweep is approximate). Reject an OTP whose window has already passed.
    if (session && session.expiresAt && session.expiresAt.getTime() < Date.now() && !isDevBypass) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
    }

    if (session && session.otp !== cleanOtp && !isDevBypass) {
      session.attempts = (session.attempts || 0) + 1;
      if (session.attempts >= 5) {
        await session.deleteOne();
        return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
      }
      await session.save();
      return res.status(400).json({ success: false, message: 'Invalid OTP entered. Please try again.' });
    }

    if (session) {
      session.verified = true;
      await session.save();
    }

    const existingUser = await User.findOne({ mobile: cleanMobile });

    if (existingUser) {
      // Increment tokenVersion on new login so previous device sessions are automatically revoked
      existingUser.tokenVersion = (existingUser.tokenVersion || 1) + 1;
      await existingUser.save();

      const token = generateToken(existingUser._id, existingUser.tokenVersion);
      const clientOrigin = process.env.FRONTEND_URL || process.env.CLIENT_URL || req.get('origin') || 'https://bjp-scheme.vercel.app';
      const referralLink = `${clientOrigin.replace(/\/$/, '')}/r/${existingUser.referralCode}`;
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully. Welcome back!',
        isExistingUser: true,
        has_card: true,
        epic_no: existingUser.epicNo,
        voter_name: existingUser.voterName,
        bjp_code: existingUser.referralCode,
        referral_link: referralLink,
        epicPending: existingUser.epicNo.startsWith('PND-'),
        token,
        user: existingUser
      });
    } else {
      // New user — capture them as an incomplete registration so no lead is lost
      IncompleteRegistration.updateOne(
        { mobile: cleanMobile },
        { $set: { stage: 'OTP_VERIFIED', verifiedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      ).catch((err) => console.error('[verifyOtp] IncompleteRegistration upsert error:', err.message));

      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully. Please provide your EPIC number.',
        isExistingUser: false,
        requireEpic: true
      });
    }
  } catch (error) {
    console.error('[verifyOtp Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP' });
  }
};

// @desc    Check Mobile Status
// @route   POST /api/check-mobile
const checkMobile = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ success: false, message: 'Mobile required' });

    const cleanMobile = mobile.trim();
    const exists = await User.exists({ mobile: cleanMobile });

    return res.status(200).json({
      success: true,
      registered: !!exists
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Validate EPIC Number from Voter DB
// @route   POST /api/validate-epic
const validateEpic = async (req, res) => {
  try {
    const epicNo = req.body.epic_no || req.body.epicNo;
    const mobile = req.body.mobile;

    if (!epicNo || epicNo.trim().length < 4) {
      return res.status(400).json({ success: false, message: 'Please provide a valid EPIC number' });
    }

    const cleanEpic = epicNo.trim().toUpperCase();

    // Fast parallel batch search across assembly collections
    const result = await findVoterByEpic(cleanEpic);

    if (!result || !result.doc) {
      return res.status(404).json({
        success: false,
        message: `EPIC '${cleanEpic}' not found in Tamil Nadu Voter Roll. Please check your voter ID card.`
      });
    }

    const doc = result.doc;
    const colName = result.colName || '';
    const foundDoc = {
      epic_no: doc.EPIC_NO,
      name: doc.VOTER_NAME,
      father_name: doc.RELATION_NAME || doc.FATHER_NAME || doc.VOTER_NAME,
      district: doc.DISTRICT,
      assembly_no: doc.ASSEMBLY_NO || colName.replace('ass_', ''),
      assembly: doc.ASSEMBLY_NAME || `Assembly ${doc.ASSEMBLY_NO}`,
      part_no: doc.PART_NO || '1',
      serial_no: doc.SL_NO || '1',
      gender: doc.GENDER || 'Unspecified',
      age: doc.AGE || 35
    };

    if (!foundDoc) {
      return res.status(404).json({
        success: false,
        message: `EPIC '${cleanEpic}' not found in Tamil Nadu Voter Roll. Please check your voter ID card.`
      });
    }

    // Upgrade stage if there is a pending incomplete registration for this mobile
    if (mobile) {
      const cleanMobile2 = String(mobile).trim();
      IncompleteRegistration.updateOne(
        { mobile: cleanMobile2 },
        { $set: {
          stage: 'EPIC_VERIFIED',
          epicNo: foundDoc.epic_no,
          voterName: foundDoc.name,
          district: foundDoc.district,
          assemblyName: foundDoc.assembly,
          boothNo: String(foundDoc.part_no || '')
        }}
      ).catch((err) => console.error('[validateEpic] IncompleteRegistration update error:', err.message));
    }

    return res.status(200).json({
      success: true,
      voter: foundDoc
    });
  } catch (error) {
    console.error('[validateEpic Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get User Profile & Registered Schemes
// @route   GET /api/profile/:epicNo
const getProfile = async (req, res) => {
  try {
    // Identity comes from the authenticated token (protectUser), NOT from the
    // URL param — this prevents anyone from reading another member's profile by
    // supplying an arbitrary EPIC number (IDOR).
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Identity is the mobile number (unique). EPIC can be shared by multiple
    // members, so we must NOT match applications by epicNo — that would leak
    // another member's applications who happen to share the same voter ID.
    const appConditions = [{ userId: user._id }];
    if (user.mobile) appConditions.push({ mobile: user.mobile });

    const applications = await SchemeApplication.find({ $or: appConditions }).sort({ appliedAt: -1 });

    return res.status(200).json({
      success: true,
      user,
      applications,
      referralCode: user.referralCode,
      ntCode: user.referralCode
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Register Selected Schemes & Complete Registration
// @route   POST /api/register-schemes
const registerSchemes = async (req, res) => {
  try {
    const {
      mobile, epicNo, epic_no, voterName, name, district, assemblyName, assembly,
      boothNo, part_no, gender, schemes, schemeIds, referralCode, refCode, referredBy, photo
    } = req.body;

    const cleanMobile = (mobile || '').trim();
    const cleanEpic = (epicNo || epic_no || '').trim().toUpperCase();
    const cleanName = (voterName || name || 'BJP Member').trim();
    const cleanDist = (district || 'TAMIL NADU').trim();
    const cleanAss  = (assemblyName || assembly || 'Assembly').trim();
    const cleanBooth = (boothNo || part_no || '1').toString().trim();

    if (!cleanMobile && !cleanEpic) {
      return res.status(400).json({ success: false, message: 'Mobile or EPIC number is required' });
    }

    // ── Authorisation ──
    // Accept EITHER a valid user JWT (existing member adding schemes) OR a
    // verified OTP session for this mobile (brand-new member completing sign-up).
    // This blocks anonymous callers from creating users / inflating referrals.
    let tokenUser = null;
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        tokenUser = await User.findById(decoded.id);
      } catch { /* invalid token — fall through to OTP-session check */ }
    }
    if (!tokenUser) {
      const verifiedSession = cleanMobile
        ? await OtpSession.findOne({ mobile: cleanMobile, verified: true })
        : null;
      if (!verifiedSession) {
        return res.status(401).json({ success: false, message: 'Verification required. Please verify your mobile via OTP first.' });
      }
    }

    // Users are keyed by mobile number (unique). EPIC is NOT unique — multiple
    // members can share the same voter ID — so we never look up or dedupe users
    // by epic. This keeps user 2 (different mobile, same EPIC) a separate user.
    let user = tokenUser;
    if (!user && cleanMobile) {
      user = await User.findOne({ mobile: cleanMobile });
    }

    const incomingRef = String(referredBy || refCode || '').trim().toUpperCase();
    console.log('[registerSchemes] mobile=%s referredBy=%s', cleanMobile, incomingRef || '(none)');

    // Validate referredBy is a real user — reject phantom codes before storing.
    let validatedRef = '';
    if (incomingRef) {
      const refExists = await User.exists({
        $or: [{ referralCode: incomingRef }, { epicNo: incomingRef }, { mobile: incomingRef }]
      });
      if (refExists) validatedRef = incomingRef;
      else console.log('[registerSchemes] referredBy=%s not found — ignoring', incomingRef);
    }

    if (!user) {
      let ntCode;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = 'NT-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const exists = await User.exists({ referralCode: candidate });
        if (!exists) { ntCode = candidate; break; }
      }
      if (!ntCode) throw new Error('Failed to generate unique referral code');

      user = await User.create({
        mobile: cleanMobile || '0000000000',
        epicNo: cleanEpic || ('PND-' + cleanMobile),
        voterName: cleanName,
        district: cleanDist,
        assemblyName: cleanAss,
        boothNo: cleanBooth,
        gender: gender || 'Unspecified',
        referralCode: ntCode,
        referredBy: validatedRef || null
      });
    } else if (validatedRef && !user.referredBy && validatedRef !== String(user.referralCode || '').toUpperCase()) {
      // Existing member with no referrer yet → attribute them to this referral.
      user.referredBy = validatedRef;
      await user.save();
    }

    // List of selected schemes to register
    const targetSchemes = schemeIds || schemes || ['PM_KISAN', 'PM_UJJWALA', 'AYUSHMAN_BHARAT'];
    const registeredApps = [];

    const { getSchemesCatalog } = require('./schemeController');
    const BJP_SCHEMES_LIST = await getSchemesCatalog();

    for (let sch of targetSchemes) {
      const schemeKey = String(sch);
      // Look up scheme metadata in BJP_SCHEMES_LIST
      const matched = (BJP_SCHEMES_LIST || []).find(s =>
        s.name.toLowerCase() === schemeKey.toLowerCase() ||
        schemeKey.toLowerCase().includes(s.name.toLowerCase()) ||
        (s.id && Number(schemeKey) === s.id)
      );
      // Use the matched scheme's canonical short name; fall back to what was sent.
      const schemeName = matched ? matched.name : schemeKey;

      // Check if already applied
      const existing = await SchemeApplication.findOne({
        $or: [
          { userId: user._id, schemeName },
          { mobile: user.mobile, schemeName }
        ]
      });

      if (!existing) {
        const app = await SchemeApplication.create({
          userId: user._id,
          voterName: user.voterName,
          epicNo: user.epicNo,
          mobile: user.mobile,
          district: user.district,
          assemblyName: user.assemblyName,
          boothNo: user.boothNo,
          schemeId: matched ? matched.id : (typeof sch === 'number' ? sch : 1),
          schemeName,
          clusterName: matched ? matched.cluster : 'BJP Nalam Thittam Welfare',
          benefit: matched ? matched.benefit : 'BJP Central Scheme Benefit',
          status: 'Submitted',
          appliedAt: new Date()
        });
        registeredApps.push(app);
      }
    }

    const token = generateToken(user._id, user.tokenVersion || 1);

    // Registration complete — remove from incomplete leads list
    if (cleanMobile) {
      IncompleteRegistration.deleteOne({ mobile: cleanMobile })
        .catch((err) => console.error('[registerSchemes] IncompleteRegistration deleteOne error:', err.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Schemes registered successfully!',
      token,
      user,
      ntCode: user.referralCode,
      referralCode: user.referralCode,
      registeredApps
    });
  } catch (error) {
    console.error('[registerSchemes Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to register schemes' });
  }
};

// @desc    Get Referral Link Info
// @route   GET /api/referral-link/:ntCode
// @access  Private (User) — requires logged-in member token
const getReferralLink = async (req, res) => {
  try {
    const { ntCode } = req.params;
    const cleanNt = ntCode.trim().toUpperCase();

    const referrer = await User.findOne({
      $or: [{ referralCode: cleanNt }, { epicNo: cleanNt }]
    }).select('voterName referralCode epicNo mobile');

    // Count using all 3 identifiers — consistent with admin stats and getMemberStatus
    const matchCodes = referrer
      ? [referrer.referralCode, referrer.epicNo, referrer.mobile].filter(Boolean)
      : [cleanNt];
    const referralCount = await User.countDocuments({ referredBy: { $in: matchCodes } });

    const clientOrigin = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://tnbjp.org';
    const referral_link = referrer
      ? `${clientOrigin.replace(/\/$/, '')}/r/${referrer.referralCode || cleanNt}`
      : '';

    return res.status(200).json({
      success: true,
      ntCode: cleanNt,
      referralCode: cleanNt,
      referral_link,
      referralCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get Referred Members List
// @route   GET /api/my-members/:ntCode
const getMyMembers = async (req, res) => {
  try {
    // Only the authenticated user's OWN referred members are returned. The
    // referral code(s) are taken from the token, not the URL param.
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const matchCodes = [user.referralCode, user.epicNo, user.mobile].filter(Boolean);

    const members = await User.find({ referredBy: { $in: matchCodes } }).select('voterName epicNo mobile district assemblyName boothNo createdAt');

    return res.status(200).json({
      success: true,
      count: members.length,
      members
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get Member Status & Applications
// @route   GET /api/member-status/:ntCode
const getMemberStatus = async (req, res) => {
  try {
    // Authenticated member's own status only (identity from token).
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const applications = await SchemeApplication.find({ userId: user._id }).sort({ appliedAt: -1 });

    // Count everyone this member has referred (matched against their referral
    // code / epic / mobile, since referredBy stores the referrer's code).
    const matchCodes = [user.referralCode, user.epicNo, user.mobile].filter(Boolean);
    const referredCount = await User.countDocuments({ referredBy: { $in: matchCodes } });

    return res.status(200).json({
      success: true,
      user,
      applications,
      referred_count: referredCount,
      referralCount: referredCount,
      created_at: user.createdAt,
      district: user.district,
      assembly_name: user.assemblyName,
      booth_no: user.boothNo,
      boothNo: user.boothNo
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Update EPIC for a user who registered without one (PND- placeholder)
// @route   PATCH /api/update-epic
const updateEpic = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });

    if (!user.epicNo.startsWith('PND-')) {
      return res.status(400).json({ success: false, message: 'Voter ID already verified for this account.' });
    }

    const epicNo = (req.body.epicNo || req.body.epic_no || '').trim().toUpperCase();
    if (!epicNo || !/^[A-Z]{3}\d{7}$/.test(epicNo)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid EPIC number (e.g. ABC1234567).' });
    }

    const result = await findVoterByEpic(epicNo);
    if (!result || !result.doc) {
      return res.status(404).json({
        success: false,
        message: `EPIC '${epicNo}' not found in Tamil Nadu Voter Roll. Please check your Voter ID card.`
      });
    }

    const doc = result.doc;
    const colName = result.colName || '';
    const voter = {
      epic_no:     doc.EPIC_NO,
      name:        doc.VOTER_NAME,
      district:    doc.DISTRICT,
      assembly_no: doc.ASSEMBLY_NO || colName.replace('ass_', ''),
      assembly:    doc.ASSEMBLY_NAME || `Assembly ${doc.ASSEMBLY_NO}`,
      part_no:     doc.PART_NO || '1',
      gender:      doc.GENDER || 'Unspecified',
      age:         doc.AGE || 35
    };

    // Update user — voter DB data is final once EPIC is verified
    user.epicNo      = voter.epic_no;
    user.voterName   = voter.name;
    user.district    = voter.district;
    user.assemblyName = voter.assembly;
    user.boothNo     = String(voter.part_no || '1');
    user.gender      = voter.gender;
    await user.save();

    // Cascade update to all scheme applications
    await SchemeApplication.updateMany(
      { userId: user._id },
      { $set: {
        epicNo:       voter.epic_no,
        voterName:    voter.name,
        district:     voter.district,
        assemblyName: voter.assembly,
        boothNo:      String(voter.part_no || '1')
      }}
    );

    return res.status(200).json({
      success: true,
      message: 'Voter ID verified and profile updated successfully!',
      voter,
      user
    });
  } catch (error) {
    console.error('[updateEpic Error]:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  checkMobile,
  validateEpic,
  getProfile,
  registerSchemes,
  getReferralLink,
  getMyMembers,
  getMemberStatus,
  updateEpic
};
