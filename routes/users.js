const express = require('express');
const router = express.Router();
const authenticate = require('../middelware/authenticate');
const User = require('../models/User');

// All routes in this file are protected and require authentication
router.use(authenticate);

// GET /api/users/me - Get the profile of the currently authenticated user
router.get('/me', async (req, res) => {
    try {
        // req.user.userId is attached by the authenticate middleware
        const user = await User.findById(req.user.userId).select('-passwordHash'); // Exclude password from the result
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET /api/users/search?q=... - Search for users by username or display name
router.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ message: 'Search query "q" is required.' });
    }

    try {
        // Search for users where username or displayName contains the query string (case-insensitive)
        const users = await User.find({
            $or: [
                { username: { $regex: query, $options: 'i' } },
                { displayName: { $regex: query, $options: 'i' } }
            ]
        })
            .select('username displayName avatarUrl _id') // Only return public information
            .limit(10); // Limit the number of results

        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// PATCH /api/users/me - Update the profile of the currently authenticated user
router.patch('/me', async (req, res) => {
    try {
        const { displayName, avatarUrl } = req.body;
        const userId = req.user.userId;

        // Create an object with the fields to update
        const updates = {};
        if (displayName !== undefined) updates.displayName = displayName;
        if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

        // Find the user by their ID and update the specified fields
        // The { new: true } option ensures the updated document is returned
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-passwordHash'); // Exclude password from the response

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.json({ message: 'Profile updated successfully.', user: updatedUser });
    } catch (error) {
        res.status(500).json({ message: 'Server error while updating profile.', error: error.message });
    }
});

module.exports = router;