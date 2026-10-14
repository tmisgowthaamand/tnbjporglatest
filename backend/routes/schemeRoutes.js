const express = require('express');
const router = express.Router();
const { applySchemes, getUserRequests, getSchemeList, suggestScheme } = require('../controllers/schemeController');
const { protectUser } = require('../middleware/authMiddleware');

router.get('/list', getSchemeList);
router.post('/apply', protectUser, applySchemes);
router.get('/my-requests', protectUser, getUserRequests);
router.post('/suggest', protectUser, suggestScheme);

module.exports = router;
