const express = require('express');
const http = require('http');
const cors = require('cors');
const admin = require('firebase-admin');
const { Server } = require('socket.io');

require('dotenv').config();

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.RTDB_URL
});

const firestore = admin.firestore();
const rtdb = admin.database();

const app = express();
const server = http.createServer(app);

// Make origin configurable for production
const io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN || '*' }
});

app.use(cors());
app.use(express.json());

// Middleware to authenticate Firebase token
async function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) return res.status(401).json({ message: 'No auth token' });

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded; // contains uid, email, name, etc.

        // Sync user profile on every request (you can optimize this if needed)
        await syncUserProfile(decoded.uid, decoded.email, decoded.name || '');

        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token', error: err.message });
    }
}


// Timestamp helper
const nowTs = () => admin.firestore.Timestamp.now();

// Helper to generate direct conversation id
const directConversationId = (a, b) => [a, b].sort().join('_');

// --- USER ROUTES ---

app.get('/api/users/me', authenticate, async (req, res) => {
    const ref = firestore.collection('users').doc(req.user.uid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ message: 'User not found' });
    res.json({ id: snap.id, ...snap.data() });
});

app.patch('/api/users/me', authenticate, async (req, res) => {
    const { displayName, avatarUrl } = req.body || {};
    await firestore.collection('users').doc(req.user.uid).set(
        {
            ...(displayName !== undefined ? { displayName } : {}),
            ...(avatarUrl !== undefined ? { avatarUrl } : {}),
            updatedAt: nowTs(),
        },
        { merge: true }
    );
    res.json({ message: 'Profile updated' });
});

app.post('/api/users/sync-profile', authenticate, async (req, res) => {
    try {
        const { uid, email, name } = req.user;
        await syncUserProfile(uid, email, name || '');
        res.json({ message: 'User profile synced' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to sync profile', error: err.message });
    }
});


// --- FRIENDS ROUTES ---

// Send friend request by username
app.post('/api/friends/request', authenticate, async (req, res) => {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ message: 'username required' });

    const q = await firestore.collection('users').where('username', '==', username).limit(1).get();
    if (q.empty) return res.status(404).json({ message: 'User not found' });

    const recipientUid = q.docs[0].id;
    const requesterUid = req.user.uid;

    if (recipientUid === requesterUid) return res.status(400).json({ message: 'Cannot friend yourself' });

    await firestore.collection('users').doc(recipientUid)
        .collection('friendRequestsIncoming').doc(requesterUid)
        .set({ from: requesterUid, createdAt: nowTs() });

    await firestore.collection('users').doc(requesterUid)
        .collection('friendRequestsOutgoing').doc(recipientUid)
        .set({ to: recipientUid, createdAt: nowTs() });

    res.json({ message: 'Friend request sent' });
});

// Accept friend request
app.post('/api/friends/accept', authenticate, async (req, res) => {
    const { requesterUid } = req.body || {};
    if (!requesterUid) return res.status(400).json({ message: 'requesterUid required' });

    const recipientUid = req.user.uid;
    const batch = firestore.batch();

    const incomingRef = firestore.collection('users').doc(recipientUid)
        .collection('friendRequestsIncoming').doc(requesterUid);
    const outgoingRef = firestore.collection('users').doc(requesterUid)
        .collection('friendRequestsOutgoing').doc(recipientUid);

    const recipientFriendRef = firestore.collection('users').doc(recipientUid)
        .collection('friends').doc(requesterUid);
    const requesterFriendRef = firestore.collection('users').doc(requesterUid)
        .collection('friends').doc(recipientUid);

    batch.delete(incomingRef);
    batch.delete(outgoingRef);
    batch.set(recipientFriendRef, { uid: requesterUid, since: nowTs() });
    batch.set(requesterFriendRef, { uid: recipientUid, since: nowTs() });

    await batch.commit();

    res.json({ message: 'Friend request accepted' });
});

// List friend requests (incoming)
app.get('/api/friends/requests', authenticate, async (req, res) => {
    const snaps = await firestore.collection('users').doc(req.user.uid)
        .collection('friendRequestsIncoming').orderBy('createdAt', 'desc').get();
    res.json(snaps.docs.map(d => ({ id: d.id, ...d.data() })));
});

// List friends
app.get('/api/friends', authenticate, async (req, res) => {
    const snaps = await firestore.collection('users').doc(req.user.uid)
        .collection('friends').get();
    res.json(snaps.docs.map(d => ({ id: d.id, ...d.data() })));
});

// --- MESSAGING ROUTES ---

// Send direct message; if no conversationId, generate from UIDs
app.post('/api/messages', authenticate, async (req, res) => {
    const { recipientUid, content, conversationId: cidInput } = req.body || {};
    if (!content) return res.status(400).json({ message: 'content required' });
    if (!recipientUid && !cidInput) return res.status(400).json({ message: 'recipientUid or conversationId required' });

    const senderUid = req.user.uid;
    const conversationId = cidInput || directConversationId(senderUid, recipientUid);
    const convRef = firestore.collection('conversations').doc(conversationId);
    const msgRef = convRef.collection('messages').doc();

    const messageData = {
        id: msgRef.id,
        senderUid,
        content,
        sentAt: nowTs(),
        read: false,
        attachments: [], // Firebase Storage URLs here
        type: 'direct',
    };

    const batch = firestore.batch();

    batch.set(convRef, {
        participants: cidInput ? admin.firestore.FieldValue.arrayUnion(senderUid) : [senderUid, recipientUid],
        lastMessage: content,
        updatedAt: nowTs(),
        type: 'direct',
    }, { merge: true });

    batch.set(msgRef, messageData);

    await batch.commit();

    io.to(`conv:${conversationId}`).emit('receive_message', { conversationId, ...messageData });

    res.status(201).json({ conversationId, message: messageData });
});

// List messages with pagination
app.get('/api/messages/:conversationId', authenticate, async (req, res) => {
    const { conversationId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const cursorIso = req.query.cursor;

    let q = firestore.collection('conversations').doc(conversationId)
        .collection('messages').orderBy('sentAt', 'asc').limit(limit);

    if (cursorIso) {
        const cursorTs = admin.firestore.Timestamp.fromDate(new Date(cursorIso));
        const cursorSnap = await firestore.collection('conversations').doc(conversationId)
            .collection('messages').where('sentAt', '>=', cursorTs).orderBy('sentAt', 'asc').limit(1).get();
        if (!cursorSnap.empty) q = q.startAfter(cursorSnap.docs[0]);
    }

    const snaps = await q.get();
    const messages = snaps.docs.map(d => ({ id: d.id, ...d.data() }));
    const nextCursor = messages.length ? messages[messages.length - 1].sentAt.toDate().toISOString() : null;

    res.json({ messages, nextCursor });
});

// --- PRESENCE API ---

app.post('/api/presence', authenticate, async (req, res) => {
    const uid = req.user.uid;
    const data = req.body || {};

    const presenceRef = rtdb.ref(`/presence/${uid}`);

    // Sanitize/validate fields as needed
    const presenceData = {
        online: true,
        lastActive: admin.database.ServerValue.TIMESTAMP,
        statusMessage: data.statusMessage || '',
        gameinfo: data.gameinfo || {},
        linkedAccounts: data.linkedAccounts || {}
    };

    await presenceRef.update(presenceData);

    res.json({ message: 'Presence updated in RTDB' });
});


// --- SOCKET.IO ---

io.on('connection', socket => {
    socket.on('authenticate', async (token) => {
        try {
            const decoded = await admin.auth().verifyIdToken(token);
            const uid = decoded.uid;

            socket.join(uid);
            console.log(`Socket authenticated: user ${uid}`);

            // Set presence in RTDB with lastActive timestamp and detailed info if available
            const presenceRef = rtdb.ref(`/presence/${uid}`);

            // You can expand here to accept presence details from client or default values
            await presenceRef.set({
                online: true,
                lastActive: admin.database.ServerValue.TIMESTAMP,
                statusMessage: '',
                gameinfo: {
                    gameId: null,
                    gameName: '',
                    state: '',
                    startTime: null
                },
                linkedAccounts: {
                    steam: '',
                    xbox: '',
                    psn: ''
                }
            });

            presenceRef.onDisconnect().set({
                online: false,
                lastActive: admin.database.ServerValue.TIMESTAMP
            });

        } catch (err) {
            console.log('Socket auth error:', err);
            socket.disconnect(true);
        }
    });

    socket.on('join_conv', (conversationId) => {
        socket.join(`conv:${conversationId}`);
    });

    socket.on('send_message', async (data) => {
        // Ideally, clients should call REST API to send message to keep logic central
        // But you can optionally accept and broadcast here if you want:

        io.to(`conv:${data.conversationId}`).emit('receive_message', data);
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.id);
    });
});

async function syncUserProfile(uid, email, displayName) {
    const userRef = firestore.collection('users').doc(uid);
    const doc = await userRef.get();
    const now = admin.firestore.Timestamp.now();

    if (!doc.exists) {
        // Create user profile with default values
        await userRef.set({
            email: email || '',
            displayName: displayName || '',
            username: '', // you can decide how to get or generate username
            createdAt: now,
            lastLogin: now,
            roles: ['user'],
            avatarUrl: '',
            preferences: {
                language: 'en',
                theme: 'light',
                notifications: true
            },
            settings: {
                privacy: 'public',
                dataSharing: false
            },
            friends: {},
            blockedUsers: {}
        });
        console.log(`Created user profile for UID ${uid}`);
    } else {
        // Update last login timestamp only
        await userRef.update({
            lastLogin: now
        });
        console.log(`Updated lastLogin for UID ${uid}`);
    }
}


// --- API DOCS ---

const pkg = require('./package.json');

const apiDocs = {
    name: 'VMS API',
    version: pkg.version,
    auth: {
        scheme: 'Bearer Firebase ID token',
        header: 'Authorization: Bearer <token>',
    },
    dataModels: {
        user: {
            path: 'users/{uid}',
            fields: {
                email: 'string',
                username: 'string',
                displayName: 'string',
                avatarUrl: 'string',
                roles: 'string[]',
                createdAt: 'Timestamp',
                lastLogin: 'Timestamp',
                preferences: {
                    language: 'string',
                    theme: 'string',
                    notifications: 'boolean',
                },
                settings: {
                    privacy: 'string',
                    dataSharing: 'boolean',
                },
                friends: 'map/object',
                blockedUsers: 'map/object',
            },
        },
        presence: {
            rtdb: {
                path: '/presence/{uid}',
                fields: {
                    online: 'boolean',
                    lastActive: 'number (milliseconds since epoch)',
                    statusMessage: 'string',
                    gameinfo: {
                        gameId: 'string',
                        gameName: 'string',
                        startTime: 'number|null',
                        state: 'string',
                    },
                    linkedAccounts: {
                        steam: 'string',
                        xbox: 'string',
                        psn: 'string',
                    },
                },
            },
        },
    },
    endpoints: [
        {
            method: 'GET',
            path: '/api/users/me',
            description: 'Get current user profile.',
            authRequired: true,
        },
        {
            method: 'PATCH',
            path: '/api/users/me',
            description: 'Update current user profile fields (supports `displayName`, `avatarUrl`).',
            authRequired: true,
            body: { displayName: 'string?', avatarUrl: 'string?' },
        },
        {
            method: 'POST',
            path: '/api/users/sync-profile',
            description: 'Create or update the current user profile with default values if missing.',
            authRequired: true,
        },
        {
            method: 'POST',
            path: '/api/friends/request',
            description: 'Send a friend request by username.',
            authRequired: true,
            body: { username: 'string' },
        },
        {
            method: 'POST',
            path: '/api/friends/accept',
            description: 'Accept a friend request from another user.',
            authRequired: true,
            body: { requesterUid: 'string' },
        },
        {
            method: 'GET',
            path: '/api/friends/requests',
            description: 'List incoming friend requests.',
            authRequired: true,
        },
        {
            method: 'GET',
            path: '/api/friends',
            description: 'List current user\'s friends.',
            authRequired: true,
        },
        {
            method: 'POST',
            path: '/api/messages',
            description: 'Send a direct message; creates conversation if needed.',
            authRequired: true,
            body: {
                recipientUid: 'string (required if conversationId not provided)',
                conversationId: 'string (optional)',
                content: 'string (required)',
            },
        },
        {
            method: 'GET',
            path: '/api/messages/:conversationId',
            description: 'List messages in a conversation with pagination support.',
            authRequired: true,
            pathParams: { conversationId: 'string' },
            query: { limit: 'number (default 20, max 100)', cursor: 'ISO string (optional)' },
        },
        {
            method: 'POST',
            path: '/api/presence',
            description: 'Update presence information in Realtime Database for the current user.',
            authRequired: true,
            body: {
                statusMessage: 'string (optional)',
                gameinfo: 'object (optional) - see data model for structure',
                linkedAccounts: 'object (optional) - e.g. steam, xbox, psn IDs',
            },
        }
    ],
    socket: {
        namespace: '/',
        notes: 'Connect via Socket.IO, authenticate, and join conversation rooms.',
        events: [
            {
                name: 'authenticate',
                direction: 'client->server',
                payload: '<idToken:string>',
                description: 'Verifies Firebase token, joins personal room, and sets RTDB presence.',
            },
            {
                name: 'join_conv',
                direction: 'client->server',
                payload: '{ conversationId:string }',
                description: 'Joins room `conv:<conversationId>` to receive messages.',
            },
            {
                name: 'send_message',
                direction: 'client->server',
                payload: '{ conversationId:string, content:string, ... }',
                description: 'Optional Socket.IO message send. Server broadcasts `receive_message` event.',
            },
            {
                name: 'receive_message',
                direction: 'server->client',
                payload: '{ conversationId:string, id:string, senderUid:string, content:string, sentAt:Timestamp, ... }',
                description: 'Emitted to room `conv:<conversationId>` when a message is sent.',
            }
        ],
    },
};

app.get('/info', (req, res) => {
    res.status(200).json(apiDocs);
});


// Listen on the Cloud Run provided port and all interfaces
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
