// routes/friendRoutes.js
const express = require('express');
const router = express.Router();
const { sendFriendRequest, acceptFriendRequest, listFriendRequests, listFriends } = require('../controllers/friendController');
const authenticate = require('../middelware/authenticate');

// All routes are protected
router.use(authenticate);

// GET /api/friends - Get the list of friends
router.get('/', listFriends);

// GET /api/friends/requests - Get pending friend requests
router.get('/requests', listFriendRequests);

// POST /api/friends/request - Send a friend request
router.post('/request', sendFriendRequest);

// POST /api/friends/accept - Accept a friend request
router.post('/accept', acceptFriendRequest);

module.exports = router;