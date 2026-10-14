const mongoose = require('mongoose');

// In-progress WhatsApp (WACTO) registration for one phone. Stored in Mongo, not
// memory, because bjptn-backend runs as a PM2 cluster — each tap can hit a
// different worker. Rows expire 2 hours after the last tap.
const SESSION_TTL_SECONDS = 2 * 60 * 60;

const wactoSessionSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },   // 10-digit mobile
  // epic/name: typed input expected · choice: "What next?" sent · schemes: typed scheme numbers expected
  awaiting: { type: String, enum: ['epic', 'name', 'choice', 'schemes', null], default: null },
  voter: { type: mongoose.Schema.Types.Mixed, default: null }, // from the voter roll after a typed EPIC
  name: { type: String, default: '' },                       // typed name (no-EPIC path)
  district: { type: String, default: '' },
  assembly: { type: String, default: '' },
  schemes: { type: [String], default: [] },                  // Scheme.name values picked so far
  volunteer: { type: Boolean, default: false },              // "Schemes + Volunteer" chosen
  updatedAt: { type: Date, default: Date.now },
});

wactoSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: SESSION_TTL_SECONDS });

module.exports = mongoose.model('WactoSession', wactoSessionSchema);
module.exports.SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
