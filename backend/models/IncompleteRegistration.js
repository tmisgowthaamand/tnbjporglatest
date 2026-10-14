const mongoose = require('mongoose');

const incompleteRegistrationSchema = new mongoose.Schema({
  mobile: { type: String, required: true, unique: true, index: true },
  stage: {
    type: String,
    enum: ['OTP_VERIFIED', 'EPIC_VERIFIED'],
    default: 'OTP_VERIFIED'
  },
  verifiedAt: { type: Date, default: Date.now },
  epicNo: { type: String, default: null },
  voterName: { type: String, default: null },
  district: { type: String, default: null },
  assemblyName: { type: String, default: null },
  boothNo: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('IncompleteRegistration', incompleteRegistrationSchema);
