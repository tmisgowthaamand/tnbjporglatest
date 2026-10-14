const express = require('express');
const router = express.Router();
const { getReferralStats, getL2Members } = require('../controllers/referralController');
const { protectUser } = require('../middleware/authMiddleware');

router.get('/my-referrals', protectUser, getReferralStats);
router.get('/l2-members/:referralCode', protectUser, getL2Members);

module.exports = router;
