const express = require('express');
const authenticate = require('../middelware/authenticate');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const router = express.Router();

router.post('/send', authenticate, async (req, res) => {
    try {
        let { recipientId, recipientUsername, content, chatType = 'direct' } = req.body;
        const senderId = req.user.userId;

        // If recipientUsername is provided, look up the ObjectId
        if (!recipientId && recipientUsername) {
            const recipient = await User.findOne({ username: recipientUsername });
            if (!recipient) {
                return res.status(404).json({ message: 'Recipient username not found' });
            }
            recipientId = recipient._id;
        }

        if (!recipientId) {
            return res.status(400).json({ message: 'RecipientId or recipientUsername is required' });
        }

        // Verify that the recipient is a friend
        const sender = await User.findById(senderId);
        // Note: Mongoose ObjectIds in the array need to be converted to strings for comparison
        if (!sender.friends.map(id => id.toString()).includes(recipientId.toString())) {
            return res.status(403).json({ message: 'You can only send messages to your friends.' });
        }

        // Create and save the message
        const message = new Message({
            senderId,
            recipientId,
            content,
            chatType,
            timestamp: new Date(),
            read: false
        });
        await message.save();

        // Update or create chat session
        let chat = await Chat.findOne({
            type: chatType,
            participants: { $all: [senderId, recipientId] }
        });
        if (!chat) {
            chat = new Chat({
                type: chatType,
                participants: [senderId, recipientId],
                lastMessage: message._id,
                updatedAt: new Date()
            });
        } else {
            chat.lastMessage = message._id;
            chat.updatedAt = new Date();
        }
        await chat.save();

        res.status(201).json({ message: 'Message sent!', data: message });
    } catch (err) {
        res.status(500).json({ message: 'Failed to send message', error: err.message });
    }
});

// GET /messages - Get all messages received by the authenticated user
router.get('/get', authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const messages = await Message.find({ recipientId: userId })
            .populate('senderId', 'displayName username');

        const formattedMessages = messages.map(msg => {
            const sender = msg.senderId;
            return {
                _id: msg._id,
                content: msg.content,
                timestamp: msg.timestamp,
                read: msg.read,
                sender: {
                    displayName: sender ? sender.displayName : 'Unknown',
                    username: sender ? sender.username : 'unknown'
                }
            };
        });

        res.status(200).json({ messages: formattedMessages });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch messages', error: err.message });
    }
});

// GET /api/messages/chat/:friendId - Get conversation with a specific friend
router.get('/chat/:friendId', authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const friendId = req.params.friendId;

        // Find all messages exchanged between the authenticated user and the friend
        const messages = await Message.find({
            $or: [
                { senderId: userId, recipientId: friendId },
                { senderId: friendId, recipientId: userId }
            ]
        })
            .sort({ timestamp: 'asc' }) // Sort messages chronologically
            .populate('senderId', 'username displayName'); // Get sender's details

        res.status(200).json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch chat history', error: err.message });
    }
});




module.exports = router;