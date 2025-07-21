const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    name:      { type: String, required: true },
    members:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    adminIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now },
    avatarUrl: { type: String }
});

module.exports = mongoose.model('Group', groupSchema);
