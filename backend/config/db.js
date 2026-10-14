const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

// App Write Database Connection (Mongoose)
const connectAppDb = async () => {
  try {
    console.log('[App DB] 🔌 Connecting to Application DB (MongoDB)...');
    const conn = await mongoose.connect(process.env.MONGO_APP_URL, {
      maxPoolSize: 30,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      dbName: 'bjp_nalam_thittam_db'
    });
    console.log(`[App DB] ✅ Connected to Mongoose: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[App DB Connection Error]: ${error.message}`);
    process.exit(1);
  }
};

// Voter Read-Only Database Client (Native MongoDB Client for fast cross-collection queries)
let voterClient = null;

const getVoterDbClient = async () => {
  if (!voterClient) {
    console.log('[Voter DB] 🔌 Connecting to Voter Database (Atlas)...');
    const client = new MongoClient(process.env.MONGO_VOTER_URL, {
      maxPoolSize: 30,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    await client.connect();
    voterClient = client;
    console.log('[Voter DB] ✅ Native MongoClient connected');
  }
  return voterClient.db(process.env.MONGO_VOTER_DB_NAME || 'voter_db');
};

module.exports = {
  connectAppDb,
  getVoterDbClient
};
