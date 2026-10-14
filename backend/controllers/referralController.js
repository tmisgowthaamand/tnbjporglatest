const User = require('../models/User');
const SchemeApplication = require('../models/SchemeApplication');

// @desc    Get user's referral code, link, and list of referred members
// @route   GET /api/referrals/my-referrals
// @access  Private (User)
const getReferralStats = async (req, res) => {
  try {
    const user = req.user;
    const matchCodes = [user.referralCode, user.epicNo, user.mobile].filter(Boolean);

    // Fetch L1 referred users (people this user directly referred)
    const referredUsers = await User.find({ referredBy: { $in: matchCodes } })
      .select('_id voterName district referralCode mobile')
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

    const totalNetwork = Object.values(l2CountMap).reduce((a, b) => a + b, 0);

    const referredMembers = referredUsers.map(refUser => ({
      id: refUser._id,
      voterName: refUser.voterName,
      district: refUser.district,
      mobile: refUser.mobile || null,
      referralCode: refUser.referralCode,
      level2Count: l2CountMap[refUser.referralCode] || 0
    }));

    return res.status(200).json({
      success: true,
      referralCode: user.referralCode,
      totalDirect: referredMembers.length,
      totalNetwork,
      totalImpact: referredMembers.length + totalNetwork,
      totalReferred: referredMembers.length, // backward compat
      referredMembers
    });
  } catch (error) {
    console.error('[getReferralStats Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load referral data' });
  }
};

// @desc    Get L2 members under a specific L1 referral code (lazy load on tap)
// @route   GET /api/referrals/l2-members/:referralCode
// @access  Private (User)
const getL2Members = async (req, res) => {
  try {
    const { referralCode } = req.params;
    if (!referralCode) {
      return res.status(400).json({ success: false, message: 'Referral code required' });
    }

    const l2Users = await User.find({ referredBy: referralCode })
      .select('_id voterName district mobile')
      .sort({ createdAt: -1 })
      .lean();

    const members = l2Users.map(u => ({
      id: u._id,
      voterName: u.voterName,
      district: u.district,
      mobile: u.mobile || null
    }));

    return res.status(200).json({ success: true, members });
  } catch (error) {
    console.error('[getL2Members Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load L2 members' });
  }
};

module.exports = {
  getReferralStats,
  getL2Members
};
