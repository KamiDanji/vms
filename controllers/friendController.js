// controllers/friendController.js
const User = require('../models/User');

// Send a friend request by username
const sendFriendRequest = async (req, res) => {
    const { username } = req.body; // Send request to this username
    const senderId = req.user.userId;

    try {
        const sender = await User.findById(senderId);
        const recipient = await User.findOne({ username });

        if (!recipient) {
            return res.status(404).json({ message: 'User not found.' });
        }
        if (sender.friends.includes(recipient._id)) {
            return res.status(400).json({ message: 'You are already friends.' });
        }
        if (recipient.receivedFriendRequests.includes(senderId)) {
            return res.status(400).json({ message: 'Friend request already sent.' });
        }

        // Add request to recipient's received list and sender's sent list
        recipient.receivedFriendRequests.push(senderId);
        sender.sentFriendRequests.push(recipient._id);

        await recipient.save();
        await sender.save();

        res.status(200).json({ message: 'Friend request sent.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Accept a friend request
const acceptFriendRequest = async (req, res) => {
    const { requesterId } = req.body; // The ID of the user who sent the request
    const recipientId = req.user.userId;

    try {
        const recipient = await User.findById(recipientId);
        const requester = await User.findById(requesterId);

        if (!requester || !recipient.receivedFriendRequests.includes(requesterId)) {
            return res.status(404).json({ message: 'Friend request not found.' });
        }

        // Add to friends lists
        recipient.friends.push(requesterId);
        requester.friends.push(recipientId);

        // Remove from request lists
        recipient.receivedFriendRequests = recipient.receivedFriendRequests.filter(id => !id.equals(requesterId));
        requester.sentFriendRequests = requester.sentFriendRequests.filter(id => !id.equals(recipientId));

        await recipient.save();
        await requester.save();

        res.status(200).json({ message: 'Friend request accepted.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// List pending friend requests
const listFriendRequests = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('receivedFriendRequests', 'username displayName avatarUrl');
        res.status(200).json(user.receivedFriendRequests);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// List all friends
const listFriends = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('friends', 'username displayName avatarUrl');
        res.status(200).json(user.friends);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};


module.exports = { sendFriendRequest, acceptFriendRequest, listFriendRequests, listFriends };