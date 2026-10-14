/**
 * One-off probe: can the backend send a WhatsApp reply-button message through WACTO?
 * The docs list no interactive endpoint; the legacy v1 send says it accepts every type
 * "named in the body", so this tries a Meta-format {type:"interactive"} payload there.
 *
 * Run on the server from the backend folder (reads WACTO_API_KEY / WACTO_CHANNEL /
 * BJP_WACTO_ALLOWLIST from .env; never prints the key):
 *   cd /var/www/bjptn/backend && node /tmp/wacto_interactive_test.js channels
 *   cd /var/www/bjptn/backend && node /tmp/wacto_interactive_test.js send [connectionId]
 * "send" messages ONLY the first number in BJP_WACTO_ALLOWLIST.
 */
const path = require('path');
const mod = (m) => require(path.join(process.cwd(), 'node_modules', m));
mod('dotenv').config({ path: path.join(process.cwd(), '.env') });
const axios = mod('axios');

const KEY = process.env.WACTO_API_KEY;
const CHANNEL = process.env.WACTO_CHANNEL;
const to10 = String(process.env.BJP_WACTO_ALLOWLIST || '').split(',')[0].replace(/\D/g, '').slice(-10);
const mask = (s) => String(s).replace(/\d(?=\d{4})/g, '*');
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const show = (label, res) => console.log(label, res.status, JSON.stringify(res.data).slice(0, 600));

(async () => {
  if (!KEY || !CHANNEL) throw new Error('WACTO_API_KEY / WACTO_CHANNEL missing in .env');
  const mode = process.argv[2];

  if (mode === 'channels') {
    const res = await axios.get('https://backend.wacto.ai/api/v1.0/channels', { headers, validateStatus: () => true });
    show('GET /channels', res);
    return;
  }

  if (mode === 'send') {
    if (to10.length !== 10) throw new Error('BJP_WACTO_ALLOWLIST is empty — refusing to send');
    const body = {
      to: `91${to10}`,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: '🧪 Test from the BJP backend (button message).\n\nTap any button — nothing will be saved.' },
        action: { buttons: [
          { type: 'reply', reply: { id: 'probe_pick', title: 'Test A' } },
          { type: 'reply', reply: { id: 'probe_vol', title: 'Test B' } },
          { type: 'reply', reply: { id: 'probe_both', title: 'Test C' } },
        ] },
      },
      ...(process.argv[3] ? { connectionId: process.argv[3] } : {}),
    };
    console.log(`sending to ${mask(body.to)} via legacy v1 send…`);
    const res = await axios.post('https://backend.wacto.ai/v1/message/send-message', body, { headers, validateStatus: () => true, timeout: 15000 });
    show('POST /v1/message/send-message', res);
    return;
  }
  console.log('usage: node wacto_interactive_test.js channels | send [connectionId]');
})().catch((e) => { console.error('error:', e.message); process.exit(1); });
