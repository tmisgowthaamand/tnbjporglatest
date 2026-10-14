const mongoose = require('mongoose');

const schemeSuggestionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  mobile: { type: String, default: '' },
  epicNo: { type: String, default: '' },
  voterName: { type: String, default: '' },
  district: { type: String, default: '' },
  assemblyName: { type: String, default: '' },
  suggestion: { type: String, required: true, trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now }
});

schemeSuggestionSchema.index({ createdAt: -1 });
schemeSuggestionSchema.index({ mobile: 1 });

module.exports = mongoose.model('SchemeSuggestion', schemeSuggestionSchema);
