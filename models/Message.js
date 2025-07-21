const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    senderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId:  { type: mongoose.Schema.Types.ObjectId, required: true }, // Can be User or Group
    content:      { type: String, required: true },
    timestamp:    { type: Date, default: Date.now },
    read:         { type: Boolean, default: false },
    chatType:     { type: String, enum: ['direct', 'group'], default: 'direct' }
});

module.exports = mongoose.model('Message', messageSchema);
