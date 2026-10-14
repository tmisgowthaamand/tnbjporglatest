const { getVoterDbClient } = require('../config/db');

/**
 * Fast Parallel Batch Search for EPIC across 234 Assembly Collections.
 * Collection list is cached for 10 min to avoid redundant DB round-trip per search.
 */
let _collectionCache = null;
let _collectionCacheTs = 0;
const COLL_CACHE_TTL = 10 * 60 * 1000;

const findVoterByEpic = async (epicNo, batchSize = 35) => {
  if (!epicNo) return null;
  const cleanEpic = epicNo.trim().toUpperCase();
  const voterDb = await getVoterDbClient();

  const now = Date.now();
  if (!_collectionCache || now - _collectionCacheTs > COLL_CACHE_TTL) {
    const collections = await voterDb.listCollections().toArray();
    _collectionCache = collections.filter(c => c.name.startsWith('ass_'));
    _collectionCacheTs = now;
  }
  const assCols = _collectionCache;

  for (let i = 0; i < assCols.length; i += batchSize) {
    const batch = assCols.slice(i, i + batchSize);
    const promises = batch.map(col =>
      voterDb.collection(col.name)
        .findOne({ EPIC_NO: cleanEpic })
        .then(doc => (doc ? { doc, colName: col.name } : null))
        .catch(() => null)
    );

    const results = await Promise.all(promises);
    const match = results.find(r => r !== null);
    if (match) {
      return match;
    }
  }

  return null;
};

module.exports = {
  findVoterByEpic
};
