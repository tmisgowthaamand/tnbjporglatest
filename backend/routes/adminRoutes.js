const express = require('express');
const router = express.Router();
const {
  adminLogin,
  getAssembliesList,
  getDistrictCredentials,
  getAssemblyCredentials,
  getAssemblyBoothCredentials,
  getDashboardStats,
  getMemberReferrals,
  getApplicationsList,
  exportApplicationsCsv,
  exportApplicationsExcel,
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
  exportAnalyticsExcel,
  exportVolunteerRequestsExcel,
} = require('../controllers/adminController');
const {
  getAllSchemesAdmin,
  createScheme,
  updateScheme,
  deleteScheme
} = require('../controllers/schemeAdminController');
const { getAdminBoothPresidentRequests, handleBoothPresidentAction, getVolunteerMap } = require('../controllers/boothPresidentController');
const { getReferralMap, getReferrers, exportReferrersExcel } = require('../controllers/adminReferralController');
const { protectAdmin, authorizeRoles } = require('../middleware/authMiddleware');

router.post('/login', adminLogin);
router.get('/jurisdiction-assemblies', protectAdmin, getAssembliesList);

// Restrict all credentials endpoints STRICTLY to SUPER_ADMIN only
router.get('/jurisdiction-district-credentials', protectAdmin, authorizeRoles('SUPER_ADMIN'), getDistrictCredentials);
router.get('/jurisdiction-assembly-credentials', protectAdmin, authorizeRoles('SUPER_ADMIN'), getAssemblyCredentials);
router.get('/assembly-booth-credentials', protectAdmin, authorizeRoles('SUPER_ADMIN'), getAssemblyBoothCredentials);

router.get('/dashboard-stats', protectAdmin, getDashboardStats);
router.get('/trends', protectAdmin, getTrends);
router.get('/coverage', protectAdmin, getCoverage);
router.get('/map-analytics', protectAdmin, getMapAnalytics);
router.get('/filter-meta', protectAdmin, getFilterMeta);
router.get('/member-referrals', protectAdmin, getMemberReferrals);
router.get('/applications', protectAdmin, getApplicationsList);
router.get('/booth-voter-roll', protectAdmin, getBoothVoterRoll);
router.get('/export-csv', protectAdmin, exportApplicationsCsv);
router.get('/export-excel', protectAdmin, exportApplicationsExcel);
router.get('/export-analytics', protectAdmin, exportAnalyticsExcel);
router.put('/applications/:id/status', protectAdmin, updateApplicationStatus);
router.put('/applications/bulk-status', protectAdmin, bulkUpdateApplicationStatus);
router.post('/create-credential', protectAdmin, authorizeRoles('SUPER_ADMIN'), createAdminCredential);
router.get('/credentials', protectAdmin, authorizeRoles('SUPER_ADMIN'), getAllAdmins);

// ── Incomplete registrations (SUPER_ADMIN and STATE_ADMIN) ──
router.get('/incomplete-registrations', protectAdmin, authorizeRoles('SUPER_ADMIN', 'STATE_ADMIN'), getIncompleteRegistrations);

// ── Member management (SUPER_ADMIN only) ──
router.delete('/members/:userId', protectAdmin, authorizeRoles('SUPER_ADMIN'), deleteMember);
router.get('/scheme-suggestions', protectAdmin, authorizeRoles('SUPER_ADMIN'), getSchemeSuggestions);

// ── Booth President management ──
router.get('/booth-president-requests', protectAdmin, getAdminBoothPresidentRequests);
router.post('/booth-president-requests/:id/action', protectAdmin, handleBoothPresidentAction);
router.get('/export-volunteer-requests', protectAdmin, exportVolunteerRequestsExcel);
router.get('/volunteer-map', protectAdmin, authorizeRoles('SUPER_ADMIN', 'STATE_ADMIN'), getVolunteerMap);

// ── Referrals (state-wide view) ──
router.get('/referral-map', protectAdmin, authorizeRoles('SUPER_ADMIN', 'STATE_ADMIN'), getReferralMap);
router.get('/referrers', protectAdmin, authorizeRoles('SUPER_ADMIN', 'STATE_ADMIN'), getReferrers);
router.get('/export-referrers', protectAdmin, authorizeRoles('SUPER_ADMIN', 'STATE_ADMIN'), exportReferrersExcel);

// ── Scheme management (SUPER_ADMIN only) ──
router.get('/schemes', protectAdmin, authorizeRoles('SUPER_ADMIN'), getAllSchemesAdmin);
router.post('/schemes', protectAdmin, authorizeRoles('SUPER_ADMIN'), createScheme);
router.put('/schemes/:id', protectAdmin, authorizeRoles('SUPER_ADMIN'), updateScheme);
router.delete('/schemes/:id', protectAdmin, authorizeRoles('SUPER_ADMIN'), deleteScheme);

module.exports = router;
