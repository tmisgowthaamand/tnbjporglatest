/**
 * WACTO BSP — outbound WhatsApp messages for the BJP Nalam Thittam chatbot.
 * Same REST API as the EDMS sender (EDM/backend/src/services/wactoService.js).
 *
 * Env vars required:
 *   WACTO_API_KEY   — bearer token
 *   WACTO_CHANNEL   — the BJP WhatsApp number used as channel (e.g. 9198xxxxxxxx)
 *   WACTO_BASE_URL  — defaults to https://backend.wacto.ai/api/v1.0
 */
const axios = require('axios');

const BASE_URL = process.env.WACTO_BASE_URL || 'https://backend.wacto.ai/api/v1.0';
const TIMEOUT_MS = 15000;

const getKey = () => process.env.WACTO_API_KEY || '';
const getChannel = () => process.env.WACTO_CHANNEL || '';

function wactoConfigured() {
  return !!(getKey() && getChannel());
}

function toWaPhone(mobile) {
  const d = String(mobile).replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

async function post(path, body) {
  const key = getKey();
  const channel = getChannel();
  if (!key || !channel) throw new Error('WACTO not configured (WACTO_API_KEY / WACTO_CHANNEL missing)');
  try {
    const res = await axios.post(`${BASE_URL}${path}/${channel}`, body, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`WACTO API error: ${msg}`);
  }
}

// Free-form text (only inside the 24-hour user-initiated window).
async function sendWactoText(mobile, text) {
  return post('/messages/send-text', { to: toWaPhone(mobile), type: 'text', text: { body: text } });
}

async function sendWactoImageWithCaption(mobile, imageUrl, caption) {
  return post('/messages/send-image', { to: toWaPhone(mobile), image: { link: imageUrl, caption } });
}

// Reply buttons / list messages. The v1.0 API has no interactive endpoint; the legacy
// v1 send takes any Meta message type named in the body (proven live 2026-10-09:
// a 3-button message was delivered and the tap reached the webhook).
const V1_SEND_URL = process.env.WACTO_V1_SEND_URL || 'https://backend.wacto.ai/v1/message/send-message';

async function sendWactoInteractive(mobile, interactive) {
  const key = getKey();
  if (!key) throw new Error('WACTO not configured (WACTO_API_KEY missing)');
  const body = { to: toWaPhone(mobile), type: 'interactive', interactive };
  if (process.env.WACTO_CONNECTION_ID) body.connectionId = process.env.WACTO_CONNECTION_ID;
  try {
    const res = await axios.post(V1_SEND_URL, body, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`WACTO API error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
}

module.exports = { wactoConfigured, sendWactoText, sendWactoImageWithCaption, sendWactoInteractive };
