const mongoose = require('mongoose');

const presenceSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    status:     { type: String, enum: ['online', 'offline', 'away'], default: 'offline' },
    lastActive: { type: Date, default: Date.now },
    device:     { type: String, enum: ['web', 'mobile', 'desktop'] }
});

module.exports = mongoose.model('Presence', presenceSchema);
