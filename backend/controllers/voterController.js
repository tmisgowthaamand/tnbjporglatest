const jwt = require('jsonwebtoken');
const { getVoterDbClient } = require('../config/db');
const { findVoterByEpic } = require('../services/voterSearchService');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');

const generateToken = (id, tokenVersion = 1) => {
  return jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// @desc    Search EPIC number in Read-Only Voter DB across all assembly collections
// @route   POST /api/voter/search-epic
// @access  Public
const searchEpic = async (req, res) => {
  try {
    const { epicNo } = req.body;
    if (!epicNo || epicNo.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Please enter a valid EPIC number' });
    }

    const cleanEpic = epicNo.trim().toUpperCase();

    // Check if EPIC already registered in App DB
    const registeredUser = await User.findOne({ epicNo: cleanEpic });
    if (registeredUser) {
      return res.status(400).json({
        success: false,
        message: `EPIC ${cleanEpic} is already registered under mobile ending in ...${registeredUser.mobile.slice(-4)}. Please login with that mobile number.`
      });
    }

    const result = await findVoterByEpic(cleanEpic);

    if (!result || !result.doc) {
      return res.status(404).json({
        success: false,
        message: `EPIC number '${cleanEpic}' was not found in voter database. Please double check your EPIC card number.`
      });
    }

    const voterDoc = result.doc;
    const colName = result.colName || '';
    const foundVoter = {
      epicNo: voterDoc.EPIC_NO,
      voterName: voterDoc.VOTER_NAME,
      district: voterDoc.DISTRICT,
      assemblyNo: voterDoc.ASSEMBLY_NO || colName.replace('ass_', ''),
      assemblyName: voterDoc.ASSEMBLY_NAME || 'Assembly ' + voterDoc.ASSEMBLY_NO,
      boothNo: voterDoc.PART_NO || '1',
      gender: voterDoc.GENDER || 'Unspecified'
    };

    if (!foundVoter) {
      return res.status(404).json({
        success: false,
        message: `EPIC number '${cleanEpic}' was not found in voter database. Please double check your EPIC card number.`
      });
    }

    return res.status(200).json({
      success: true,
      voter: foundVoter
    });
  } catch (error) {
    console.error('[searchEpic Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to query voter database' });
  }
};

// @desc    Confirm Voter details & complete Registration
// @route   POST /api/voter/confirm-registration
// @access  Disabled — legacy endpoint removed due to account-takeover vulnerability.
//          The $or lookup (mobile OR epicNo) allowed an attacker with a verified OTP
//          on their own mobile to receive a JWT for a different user's account by
//          supplying that user's EPIC. Registration now goes through /api/register-schemes.
const confirmVoterRegistration = (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'This endpoint is no longer available. Please use the current registration flow.'
  });
};

module.exports = {
  searchEpic,
  confirmVoterRegistration
};
