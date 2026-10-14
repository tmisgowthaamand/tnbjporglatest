/**
 * Seed script: 100 real voter applications per assembly across all TN assemblies
 * Pulls EPIC_NO, VOTER_NAME, DISTRICT, ASSEMBLY_NAME from voter DB
 * Run:    node seed-test-data.js
 * Delete: node seed-test-data.js --delete
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

const SchemeApplication = require('./models/SchemeApplication');

const APPS_PER_ASSEMBLY = 100;
const SEED_MARKER = 'SEEDED'; // stored in adminRemarks for easy bulk-delete

const SCHEMES = [
  { id: 1,  name: 'e-Shram' },
  { id: 2,  name: 'ABHA' },
  { id: 3,  name: 'Udyam' },
  { id: 4,  name: 'PMSBY' },
  { id: 5,  name: 'PMJJBY' },
  { id: 6,  name: 'Jan Dhan' },
  { id: 7,  name: 'PM Kisan' },
  { id: 8,  name: 'Ayushman Bharat' },
];

const STATUSES = ['Pending', 'Processing', 'Called', 'Approved', 'Rejected', 'Submitted'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  const isDelete = process.argv.includes('--delete');

  // Connect app DB
  await mongoose.connect(process.env.MONGO_APP_URL, {
    dbName: 'bjp_nalam_thittam_db',
  });
  console.log('[App DB] Connected');

  if (isDelete) {
    const result = await SchemeApplication.deleteMany({ adminRemarks: SEED_MARKER });
    console.log(`Deleted ${result.deletedCount} seeded records.`);
    await mongoose.disconnect();
    return;
  }

  // Connect voter DB
  const voterClient = new MongoClient(process.env.MONGO_VOTER_URL);
  await voterClient.connect();
  const voterDb = voterClient.db(process.env.MONGO_VOTER_DB_NAME || 'voter_db');
  console.log('[Voter DB] Connected');

  // List all assembly collections
  const allCols = await voterDb.listCollections().toArray();
  const assCols = allCols.filter(c => c.name.startsWith('ass_')).map(c => c.name);
  console.log(`Found ${assCols.length} assembly collections. Seeding ${APPS_PER_ASSEMBLY} per assembly...`);

  let totalInserted = 0;
  let assembliesProcessed = 0;
  const batchSize = 500;
  let batch = [];

  for (const colName of assCols) {
    // Get assembly name and district from a sample doc
    const sample = await voterDb.collection(colName).findOne(
      {},
      { projection: { ASSEMBLY_NAME: 1, DISTRICT: 1, _id: 0 } }
    );
    if (!sample || !sample.ASSEMBLY_NAME || !sample.DISTRICT) {
      console.warn(`  Skipping ${colName} — no sample doc`);
      continue;
    }

    const assemblyName = sample.ASSEMBLY_NAME.trim();
    const district = sample.DISTRICT.trim().toUpperCase();

    // Pull 100 voters from this collection
    const voters = await voterDb.collection(colName)
      .find({}, { projection: { EPIC_NO: 1, VOTER_NAME: 1, PART_NO: 1, _id: 0 } })
      .limit(APPS_PER_ASSEMBLY)
      .toArray();

    for (const voter of voters) {
      if (!voter.EPIC_NO || !voter.VOTER_NAME) continue;

      const scheme = rand(SCHEMES);
      const status = rand(STATUSES);
      const boothNo = String(voter.PART_NO || Math.floor(Math.random() * 20) + 1);
      const daysAgo = Math.floor(Math.random() * 60);

      batch.push({
        userId: new mongoose.Types.ObjectId(),
        epicNo: voter.EPIC_NO,
        voterName: voter.VOTER_NAME,
        mobile: `9${String(Math.floor(Math.random() * 1000000000)).padStart(9, '0')}`,
        district,
        assemblyName,
        assemblyNo: '',
        boothNo,
        schemeId: scheme.id,
        schemeName: scheme.name,
        status,
        adminRemarks: SEED_MARKER,
        appliedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      });

      totalInserted++;
    }

    assembliesProcessed++;

    if (batch.length >= batchSize) {
      await SchemeApplication.insertMany(batch, { ordered: false });
      process.stdout.write(`\r${assembliesProcessed}/${assCols.length} assemblies | ${totalInserted} records inserted`);
      batch = [];
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await SchemeApplication.insertMany(batch, { ordered: false });
  }

  console.log(`\n\nDone!`);
  console.log(`  Assemblies seeded: ${assembliesProcessed}`);
  console.log(`  Total records:     ${totalInserted}`);
  console.log(`\nTo delete all seeded records later: node seed-test-data.js --delete`);

  await voterClient.close();
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
