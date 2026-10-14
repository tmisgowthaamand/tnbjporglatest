// node sentry_scrub_test.js <backendDir> on|off
const path = require('path');
const B = path.resolve(process.argv[2]); const useScrub = process.argv[3] === 'on';
const req = (m) => require(path.join(B, 'node_modules', m));
const Sentry = req('@sentry/node'); const { createTransport } = req('@sentry/core');
const { scrubSentryEvent } = require(path.join(B, 'services', 'sentryScrub.js'));
const sent = [];
Sentry.init({
  dsn: 'https://public@o1.ingest.sentry.io/1', tracesSampleRate: 1.0,
  transport: (opts) => createTransport(opts, async (r) => { sent.push(Buffer.from(r.body).toString('utf8')); return { statusCode: 200 }; }),
  ...(useScrub ? { beforeSend: scrubSentryEvent, beforeSendTransaction: scrubSentryEvent } : {}),
});
const express = req('express'); const http = require('http');
const app = express(); app.use(express.json());
app.post('/api/whatsapp/bjp-wacto/events', (q, s) => s.sendStatus(200));
app.post('/api/whatsapp/bjp-wacto/boom', () => { throw new Error('boom'); });
Sentry.setupExpressErrorHandler(app);
app.use((e, q, s, n) => s.sendStatus(500));
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const hit = (p) => new Promise((ok) => { const r = http.request({ port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', ok); }); r.end('{"entry":[]}'); });
  await hit('/api/whatsapp/bjp-wacto/events?key=SECRETKEY123');
  await hit('/api/whatsapp/bjp-wacto/boom?key=SECRETKEY123&x=1');
  await new Promise((r) => setTimeout(r, 500)); await Sentry.flush(5000); srv.close();
  const all = sent.join('\n');
  const types = sent.map((e) => (e.match(/"type":"(event|transaction)"/g) || []).join('+')).join(', ');
  console.log(`scrub=${useScrub ? 'on ' : 'off'} envelopes=${sent.length} [${types}] secret present: ${all.includes('SECRETKEY123') ? 'YES' : 'no'}  [Filtered] present: ${all.includes('key=[Filtered]') ? 'yes' : 'no'}`);
  process.exit(0);
});
