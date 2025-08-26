// javascript
const express = require('express');
const http = require('http');
const cors = require('cors');
const admin = require('firebase-admin');
const { Server } = require('socket.io');

require('dotenv').config();

// Firebase Admin initialization
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.RTDB_URL
});

const firestore = admin.firestore();
const rtdb = admin.database();

const app = express();
const server = http.createServer(app);

// CORS for HTTP + Socket.IO
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*' } });

// Helpers
const nowTs = () => admin.firestore.Timestamp.now();
const directConversationId = (a, b) => [a, b].sort().join('_');

// Auth middleware (register defaults on first request)
async function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'No auth token' });

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded;
        await syncUserProfile(decoded.uid, decoded.email || '');
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token', error: err.message });
    }
}

// --- USER ROUTES ---

// Get current user (primary and alias)
app.get('/api/users/me', authenticate, async (req, res) => {
    const ref = firestore.collection('users').doc(req.user.uid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ message: 'User not found' });
    res.json({ id: snap.id, ...snap.data() });
});
app.get('/api/me', authenticate, async (req, res) => {
    const ref = firestore.collection('users').doc(req.user.uid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ message: 'User not found' });
    res.json({ id: snap.id, ...snap.data() });
});

// Unified update: username, avatarUrl, preferences, settings
async function updateUserHandler(req, res) {
    const uid = req.user.uid;
    const { username, avatarUrl, preferences = {}, settings = {} } = req.body || {};
    const update = { updatedAt: nowTs() };

    // Strict top-level keys
    const allowedTop = new Set(['username', 'avatarUrl', 'preferences', 'settings']);
    for (const k of Object.keys(req.body || {})) {
        if (!allowedTop.has(k)) {
            return res.status(400).json({ message: `Unknown or forbidden field '${k}'` });
        }
    }

    // Username validation + uniqueness
    if (username !== undefined) {
        const uname = String(username).trim();
        if (!/^[A-Za-z0-9_.]{3,24}$/.test(uname)) {
            return res.status(400).json({ message: 'Invalid username. Use 3–24 chars [A-Za-z0-9_.]' });
        }
        const currentDoc = await firestore.collection('users').doc(uid).get();
        const current = currentDoc.exists ? (currentDoc.data().username || '') : '';
        if (uname !== current) {
            const taken = await firestore.collection('users').where('username', '==', uname).limit(1).get();
            if (!taken.empty && taken.docs[0].id !== uid) {
                return res.status(409).json({ message: 'Username already taken' });
            }
        }
        update.username = uname;
    }

    // Avatar URL
    if (avatarUrl !== undefined) update.avatarUrl = String(avatarUrl);

    // Preferences
    if (preferences.language !== undefined) update['preferences.language'] = String(preferences.language);
    if (preferences.theme !== undefined) update['preferences.theme'] = String(preferences.theme);
    if (preferences.notifications !== undefined) update['preferences.notifications'] = !!preferences.notifications;

    // Settings
    if (settings.privacy !== undefined) {
        const privacy = String(settings.privacy);
        const allowed = new Set(['public', 'friends', 'private']);
        if (!allowed.has(privacy)) return res.status(400).json({ message: 'Invalid settings.privacy. Use public|friends|private' });
        update['settings.privacy'] = privacy;
    }
    if (settings.dataSharing !== undefined) update['settings.dataSharing'] = !!settings.dataSharing;

    if (Object.keys(update).length === 1) {
        return res.status(400).json({ message: 'No valid fields to update' });
    }

    await firestore.collection('users').doc(uid).set(update, { merge: true });
    res.json({ message: 'User updated' });
}

// Primary endpoint + backward-compatible aliases
app.patch('/api/users', authenticate, updateUserHandler);
app.patch('/api/users/me', authenticate, updateUserHandler);
app.patch('/api/users/settings', authenticate, updateUserHandler);

// Explicit sync endpoint (optional but kept)
app.post('/api/users/sync-profile', authenticate, async (req, res) => {
    try {
        await syncUserProfile(req.user.uid, req.user.email || '');
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

    const q = await firestore.collection('users').where('username', '==', String(username)).limit(1).get();
    if (q.empty) return res.status(404).json({ message: 'User not found' });

    const recipientUid = q.docs[0].id;
    const requesterUid = req.user.uid;
    if (recipientUid === requesterUid) return res.status(400).json({ message: 'Cannot friend yourself' });

    await firestore
        .collection('users').doc(recipientUid)
        .collection('friendRequestsIncoming').doc(requesterUid)
        .set({ from: requesterUid, createdAt: nowTs() });

    await firestore
        .collection('users').doc(requesterUid)
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
    if (!cidInput && recipientUid === senderUid) return res.status(400).json({ message: 'Cannot message yourself' });

    const conversationId = cidInput || directConversationId(senderUid, recipientUid);
    const convRef = firestore.collection('conversations').doc(conversationId);
    const msgRef = convRef.collection('messages').doc();

    const messageData = {
        id: msgRef.id,
        senderUid,
        content,
        sentAt: nowTs(),
        read: false,
        attachments: [],
        type: 'direct'
    };

    const batch = firestore.batch();
    batch.set(
        convRef,
        {
            participants: cidInput ? admin.firestore.FieldValue.arrayUnion(senderUid) : [senderUid, recipientUid],
            lastMessage: content,
            updatedAt: nowTs(),
            type: 'direct'
        },
        { merge: true }
    );
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

// --- PRESENCE API (HTTP) ---

app.post('/api/presence', authenticate, async (req, res) => {
    const uid = req.user.uid;
    const data = req.body || {};
    const presenceRef = rtdb.ref(`/presence/${uid}`);

    const presenceData = {
        online: true,
        lastActive: admin.database.ServerValue.TIMESTAMP,
        statusMessage: data.statusMessage || '',
        gameinfo: {
            gameId: data.gameinfo?.gameId ?? null,
            gameName: data.gameinfo?.gameName ?? '',
            state: data.gameinfo?.state ?? '',
            startTime: data.gameinfo?.startTime ?? null
        },
        linkedAccounts: {
            steam: data.linkedAccounts?.steam ?? '',
            xbox: data.linkedAccounts?.xbox ?? '',
            psn: data.linkedAccounts?.psn ?? ''
        }
    };

    await presenceRef.update(presenceData);
    res.json({ message: 'Presence updated in RTDB' });
});

// --- SOCKET.IO ---

io.on('connection', socket => {
    socket.on('authenticate', async token => {
        try {
            const decoded = await admin.auth().verifyIdToken(token);
            const uid = decoded.uid;

            socket.join(uid);
            console.log(`Socket authenticated: user ${uid}`);

            const presenceRef = rtdb.ref(`/presence/${uid}`);
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

    socket.on('join_conv', conversationId => {
        socket.join(`conv:${conversationId}`);
    });

    socket.on('send_message', async data => {
        io.to(`conv:${data.conversationId}`).emit('receive_message', data);
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.id);
    });
});

// --- PROFILE SYNC ---

async function syncUserProfile(uid, email) {
    const userRef = firestore.collection('users').doc(uid);
    const doc = await userRef.get();
    const now = nowTs();

    if (!doc.exists) {
        await userRef.set({
            email: email || '',
            username: '', // set later by user
            createdAt: now,
            updatedAt: now,
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
        await userRef.update({ lastLogin: now });
        console.log(`Updated lastLogin for UID ${uid}`);
    }
}

// --- API DOCS ---

const pkg = require('./package.json');

const apiDocs = {
    name: 'VMS API',
    version: pkg.version,
    author: 'Veilbound Studios (KamiDanji)',
    auth: {
        scheme: 'Bearer Firebase ID token',
        header: 'Authorization: Bearer <token>'
    },
    dataModels: {
        user: {
            path: 'users/{uid}',
            fields: {
                email: 'string',
                username: 'string',
                avatarUrl: 'string',
                roles: 'string[]',
                createdAt: 'Timestamp',
                updatedAt: 'Timestamp',
                lastLogin: 'Timestamp',
                preferences: {
                    language: 'string',
                    theme: 'string',
                    notifications: 'boolean'
                },
                settings: {
                    privacy: 'string (public|friends|private)',
                    dataSharing: 'boolean'
                },
                friends: 'map/object',
                blockedUsers: 'map/object'
            }
        },
        presence: {
            rtdb: {
                path: '/presence/{uid}',
                fields: {
                    online: 'boolean',
                    lastActive: 'number (ms since epoch)',
                    statusMessage: 'string',
                    gameinfo: {
                        gameId: 'string|null',
                        gameName: 'string',
                        state: 'string',
                        startTime: 'number|null'
                    },
                    linkedAccounts: {
                        steam: 'string',
                        xbox: 'string',
                        psn: 'string'
                    }
                }
            }
        }
    },
    endpoints: [
        { method: 'GET', path: '/api/users/me', description: 'Get current user profile.', authRequired: true },
        { method: 'GET', path: '/api/me', description: 'Alias of `/api/users/me`.', authRequired: true },
        {
            method: 'PATCH',
            path: '/api/users',
            description: 'Update username, avatarUrl, preferences, and settings (deep merge).',
            authRequired: true,
            body: {
                username: 'string? (3–24 chars, [A-Za-z0-9_.])',
                avatarUrl: 'string?',
                preferences: { language: 'string?', theme: 'string?', notifications: 'boolean?' },
                settings: { privacy: 'string? (public|friends|private)', dataSharing: 'boolean?' }
            }
        },
        { method: 'POST', path: '/api/users/sync-profile', description: 'Create or update the current user profile with defaults if missing.', authRequired: true },
        { method: 'POST', path: '/api/friends/request', description: 'Send a friend request by username.', authRequired: true, body: { username: 'string' } },
        { method: 'POST', path: '/api/friends/accept', description: 'Accept a friend request from another user.', authRequired: true, body: { requesterUid: 'string' } },
        { method: 'GET', path: '/api/friends/requests', description: 'List incoming friend requests.', authRequired: true },
        { method: 'GET', path: '/api/friends', description: 'List current user\'s friends.', authRequired: true },
        { method: 'POST', path: '/api/messages', description: 'Send a direct message; creates conversation if needed.', authRequired: true, body: { recipientUid: 'string (required if conversationId not provided)', conversationId: 'string (optional)', content: 'string (required)' } },
        { method: 'GET', path: '/api/messages/:conversationId', description: 'List messages in a conversation with pagination support.', authRequired: true, pathParams: { conversationId: 'string' }, query: { limit: 'number (default 20, max 100)', cursor: 'ISO string (optional)' } },
        { method: 'POST', path: '/api/presence', description: 'Update presence in Realtime Database for the current user.', authRequired: true, body: { statusMessage: 'string?', gameinfo: 'object?', linkedAccounts: 'object?' } }
    ],
    socket: {
        namespace: '/',
        notes: 'Authenticate, then join conversation rooms to receive messages.',
        events: [
            { name: 'authenticate', direction: 'client->server', payload: '<idToken:string>', description: 'Verifies Firebase token, joins personal room, sets RTDB presence.' },
            { name: 'join_conv', direction: 'client->server', payload: '{ conversationId:string }', description: 'Joins room `conv:<conversationId>`.' },
            { name: 'send_message', direction: 'client->server', payload: '{ conversationId:string, content:string, ... }', description: 'Server broadcasts `receive_message` to the room.' },
            { name: 'receive_message', direction: 'server->client', payload: '{ conversationId:string, id:string, senderUid:string, content:string, sentAt:Timestamp, ... }', description: 'Emitted to room `conv:<conversationId>` when a message is sent.' }
        ]
    }
};

app.get('/info', (req, res) => {
    res.status(200).json(apiDocs);
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});