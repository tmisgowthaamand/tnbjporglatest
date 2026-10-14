const express = require('express');
const router  = express.Router();
const { handleEvents } = require('../controllers/bjpWactoController');

// WACTO message webhook — WACTO forwards every incoming WhatsApp message here.
// Set the WACTO webhook URL to: https://<api-host>/api/whatsapp/bjp-wacto/events?key=<BJP_WACTO_WEBHOOK_KEY>
// The key is a secret in the URL: Sentry scrubs it (services/sentryScrub.js) and nginx logs
// this location without the query string (log_format bjp_noquery).
router.post('/events', handleEvents);

module.exports = router;
