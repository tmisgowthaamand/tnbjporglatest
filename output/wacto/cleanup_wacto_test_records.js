/**
 * Remove the records one WhatsApp test number created during a live WACTO test.
 * Only touches documents created AT/AFTER --since, so a real, older registration on
 * the same number is never deleted. Dry run by default (prints counts + ids only).
 *
 * Run on the server from the backend folder (uses its node_modules and .env):
 *   cd /var/www/bjptn/backend
 *   node /tmp/cleanup_wacto_test_records.js <10-digit mobile> --since 2026-10-09T15:00:00+05:30
 *   node /tmp/cleanup_wacto_test_records.js <10-digit mobile> --since 2026-10-09T15:00:00+05:30 --delete
 */
const path = require('path');
const mod = (m) => require(path.join(process.cwd(), 'node_modules', m));
mod('dotenv').config({ path: path.join(process.cwd(), '.env') });
const mongoose = mod('mongoose');

const args = process.argv.slice(2);
const mobile = String(args[0] || '').replace(/\D/g, '').slice(-10);
const sinceArg = args[args.indexOf('--since') + 1];
const since = args.includes('--since') ? new Date(sinceArg) : null;
const doDelete = args.includes('--delete');
if (mobile.length !== 10 || !since || isNaN(since)) {
  console.error('usage: node cleanup_wacto_test_records.js <10-digit mobile> --since <ISO time> [--delete]');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGO_APP_URL);
  const db = mongoose.connection.db;
  const plan = [
    ['users',                   { mobile, createdAt: { $gte: since } }],
    ['schemeapplications',      { mobile, appliedAt: { $gte: since } }],
    ['boothpresidentrequests',  { mobile, appliedAt: { $gte: since } }],
    ['wactosessions',           { phone: mobile }],
  ];
  console.log(`${doDelete ? 'DELETING' : 'DRY RUN'} — mobile ******${mobile.slice(-4)}, since ${since.toISOString()}`);

  // Safety: an older account on this number stays; warn if test rows hang off it.
  const older = await db.collection('users').findOne({ mobile, createdAt: { $lt: since } }, { projection: { _id: 1 } });
  if (older) console.log(`  NOTE: this number has an account created BEFORE --since (${older._id}) — it is kept.`);

  for (const [coll, q] of plan) {
    const ids = (await db.collection(coll).find(q, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id));
    console.log(`  ${coll.padEnd(24)} ${ids.length}  ${ids.join(', ')}`);
    if (doDelete && ids.length) {
      const r = await db.collection(coll).deleteMany(q);
      console.log(`    deleted ${r.deletedCount}`);
    }
  }
  if (!doDelete) console.log('Nothing deleted. Re-run with --delete after checking the list above.');
  await mongoose.disconnect();
})().catch((e) => { console.error('error:', e.message); process.exit(1); });
