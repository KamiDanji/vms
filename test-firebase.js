// test-firebase.js
const admin = require('firebase-admin');
require('dotenv').config();


admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.RTDB_URL
});

const firestore = admin.firestore();
const rtdb = admin.database();

async function testFirestore() {
    const userRef = firestore.collection('users').doc('testUser123');

    // Write user data
    await userRef.set({
        email: 'test@mail.com',
        username: 'testuser',
        displayName: 'Test User',
        password: 'testpassword',
        createdAt: admin.firestore.Timestamp.now(),
        lastLogin: admin.firestore.Timestamp.now(),
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
    console.log('Firestore: User data written.');

    // Read user data
    const snapshot = await userRef.get();
    console.log('Firestore: User data read:', snapshot.data());
}

async function testRTDB() {
    const presenceRef = rtdb.ref('presence/testUser123');

    // Write presence data
    await presenceRef.set({
        online: true,
        lastActive: admin.database.ServerValue.TIMESTAMP,
        statusMessage: '',
        gameinfo: {
            gameId: '293234',
            gameName: 'Attack on Titan',
            startTime: null,
            state: 'Fighting for freedom'
        },
        linkedAccounts: {
            steam: 'steamUser123',
            xbox: 'xboxUser123',
            psn: 'psnUser123'
        }
    });
    console.log('RTDB: Presence data written.');

    // Read presence data
    const snapshot = await presenceRef.once('value');
    console.log('RTDB: Presence data read:', snapshot.val());
}

async function test() {
    await testFirestore();
    await testRTDB();
    process.exit(0);
}

test().catch(error => {
    console.error('Error testing Firebase:', error);
    process.exit(1);
});
