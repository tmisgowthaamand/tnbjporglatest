// Booth voter-count cache tests (getBoothVoterRollCount) against an in-memory
// fake voter DB — no network, no real database.
//
// Run:  node --test backend/tests/boothVoterCounts.test.js
// Run against another copy of the service (e.g. the previous version):
//       SERVICE_PATH=/abs/path/jurisdictionService.js node --test backend/tests/boothVoterCounts.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SERVICE_PATH = process.env.SERVICE_PATH || path.join(__dirname, '..', 'services', 'jurisdictionService.js');
const DB_PATH = path.join(__dirname, '..', 'config', 'db.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fake voter DB: N assemblies, each with booths '1' (10 voters) and '2' (20 voters).
const makeFakeDb = ({ assemblies = 5, scanDelayMs = 20, failFirstScanOf = new Set() } = {}) => {
  const stats = { scans: {}, inFlight: 0, maxInFlight: 0, pipelines: [] };
  const failed = new Set();
  const collection = (name) => ({
    findOne: async () => {
      const n = name.replace('ass_', '');
      return { DISTRICT: 'TEST DISTRICT', ASSEMBLY_NO: n, ASSEMBLY_NAME: `ASSEMBLY ${n}` };
    },
    aggregate: (pipeline) => ({
      toArray: async () => {
        if (pipeline[0].$collStats) return [{ count: 30 }];
        stats.pipelines.push(pipeline);
        stats.scans[name] = (stats.scans[name] || 0) + 1;
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        try {
          await sleep(scanDelayMs);
          if (failFirstScanOf.has(name) && !failed.has(name)) {
            failed.add(name);
            throw new Error('simulated voter DB failure');
          }
          return [{ _id: '1', count: 10 }, { _id: '2', count: 20 }];
        } finally {
          stats.inFlight--;
        }
      }
    })
  });
  const db = {
    listCollections: () => ({
      toArray: async () => Array.from({ length: assemblies }, (_, i) => ({ name: `ass_${i + 1}` }))
    }),
    collection
  };
  return { db, stats };
};

// Load a fresh copy of the service wired to the fake DB (module state is global).
const loadService = (fake) => {
  delete require.cache[require.resolve(SERVICE_PATH)];
  require.cache[require.resolve(DB_PATH)] = {
    id: DB_PATH, filename: DB_PATH, loaded: true,
    exports: { getVoterDbClient: async () => fake.db, connectAppDb: async () => {} }
  };
  // The service requires '../config/db' relative to itself; point that at the stub too.
  const serviceDbPath = require.resolve(path.join(path.dirname(SERVICE_PATH), '..', 'config', 'db.js'));
  require.cache[serviceDbPath] = require.cache[require.resolve(DB_PATH)];
  return require(SERVICE_PATH);
};

const silenceErrors = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

test('returns the correct booth counts', async () => {
  const fake = makeFakeDb();
  const svc = loadService(fake);
  assert.strictEqual(await svc.getBoothVoterRollCount('ASSEMBLY 1', '1'), 10);
  assert.strictEqual(await svc.getBoothVoterRollCount('assembly 1', 2), 20);
  assert.strictEqual(await svc.getBoothVoterRollCount('ASSEMBLY 1', '99'), null);
  assert.strictEqual(await svc.getBoothVoterRollCount('NO SUCH ASSEMBLY', '1'), null);
  assert.strictEqual(fake.stats.scans.ass_1, 1, 'one scan serves every booth of the assembly');
});

test('concurrent requests for one assembly share a single scan and none get a blank', async () => {
  const fake = makeFakeDb({ scanDelayMs: 50 });
  const svc = loadService(fake);
  const results = await Promise.all([
    svc.getBoothVoterRollCount('ASSEMBLY 2', '1'),
    svc.getBoothVoterRollCount('ASSEMBLY 2', '2'),
    svc.getBoothVoterRollCount('ASSEMBLY 2', '1'),
    svc.getBoothVoterRollCount('ASSEMBLY 2', '2')
  ]);
  assert.deepStrictEqual(results, [10, 20, 10, 20]);
  assert.strictEqual(fake.stats.scans.ass_2, 1);
});

test('a failed scan returns null and is retried on the next request', async () => {
  const fake = makeFakeDb({ failFirstScanOf: new Set(['ass_3']) });
  const svc = loadService(fake);
  const first = await silenceErrors(() => svc.getBoothVoterRollCount('ASSEMBLY 3', '1'));
  assert.strictEqual(first, null);
  const second = await svc.getBoothVoterRollCount('ASSEMBLY 3', '1');
  assert.strictEqual(second, 10, 'assembly must not stay blank after a failure');
  assert.strictEqual(fake.stats.scans.ass_3, 2);
});

test('no more than 4 assembly scans run at once, and all complete', async () => {
  const fake = makeFakeDb({ assemblies: 30, scanDelayMs: 15 });
  const svc = loadService(fake);
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) => svc.getBoothVoterRollCount(`ASSEMBLY ${i + 1}`, '2'))
  );
  assert.ok(results.every(r => r === 20));
  assert.ok(fake.stats.maxInFlight <= 4, `maxInFlight was ${fake.stats.maxInFlight}`);
  assert.strictEqual(fake.stats.maxInFlight, 4, 'uses all 4 slots');
});

test('counts for all 234 assemblies stay cached (no eviction)', async () => {
  const fake = makeFakeDb({ assemblies: 234, scanDelayMs: 1 });
  const svc = loadService(fake);
  for (let i = 1; i <= 234; i++) await svc.getBoothVoterRollCount(`ASSEMBLY ${i}`, '1');
  assert.strictEqual(await svc.getBoothVoterRollCount('ASSEMBLY 1', '2'), 20);
  assert.strictEqual(fake.stats.scans.ass_1, 1, 'first assembly was not rescanned');
  const totalScans = Object.values(fake.stats.scans).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalScans, 234);
});

test('uses the index-covered pipeline on PART_NO', async () => {
  const fake = makeFakeDb();
  const svc = loadService(fake);
  await svc.getBoothVoterRollCount('ASSEMBLY 1', '1');
  assert.deepStrictEqual(fake.stats.pipelines[0], [
    { $sort: { PART_NO: 1 } },
    { $project: { _id: 0, PART_NO: 1 } },
    { $group: { _id: '$PART_NO', count: { $sum: 1 } } }
  ]);
});
