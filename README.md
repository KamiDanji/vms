# Veilbound Messaging System (VMS)

![VMS Architecture Overview](https://via.placeholder.com/800x400?text=VMS+Architecture) <!-- Replace with actual image if available -->

## Introduction

VMS is a backend messaging service designed for the Veilbound ecosystem, integrating seamlessly with websites, game launchers, and games. It provides real-time chat, user management, friend systems, and presence tracking using Firebase's hybrid database approach (Firestore for structured data, Realtime Database for real-time presence) and Socket.IO for live updates.

Key goals:
- Secure, scalable user authentication and profiles.
- Real-time messaging with persistence.
- Presence awareness with game-specific details.
- Easy integration for cross-platform apps.

## Features

### Authentication & User Profiles
- Powered by Firebase Authentication (email/password, social providers).
- User profiles stored in Firestore with fields like email, username, displayName, roles, preferences, settings, friends, and blocked users.
- Automatic profile syncing on authentication to ensure defaults are set.

### Friends System
- Send/accept friend requests.
- List friends and pending requests.
- Stored as subcollections in Firestore for efficient querying.

### Messaging
- Direct messaging with auto-created conversations.
- Messages include content, timestamps, read status, and attachments.
- Pagination for message history.
- Real-time delivery via Socket.IO.

### Presence Tracking
- Handled in Realtime Database (RTDB) for low-latency updates.
- Includes online/offline status, last active time, status messages, game info (ID, name, state, start time), and linked accounts (Steam, Xbox, PSN).
- Updated on socket connections and explicit API calls.

## Architecture

- **Backend:** Node.js with Express.js for REST APIs.
- **Databases:**
  - Firestore: User profiles, friends, conversations, messages.
  - RTDB: Presence data for real-time sync.
- **Real-time Layer:** Socket.IO for message broadcasting and presence.
- **Authentication:** Firebase ID tokens verified on API requests and sockets.

### Data Models

#### User (Firestore: users/{uid})
- email: string
- username: string
- displayName: string
- avatarUrl: string
- roles: string[]
- createdAt: Timestamp
- lastLogin: Timestamp
- preferences: { language: string, theme: string, notifications: boolean }
- settings: { privacy: string, dataSharing: boolean }
- friends: map/object
- blockedUsers: map/object

#### Presence (RTDB: /presence/{uid})
- online: boolean
- lastActive: number (timestamp)
- statusMessage: string
- gameinfo: { gameId: string, gameName: string, startTime: number|null, state: string }
- linkedAccounts: { steam: string, xbox: string, psn: string }

## API Endpoints

### User Routes
- **GET /api/users/me**: Get current user profile (auth required).
- **PATCH /api/users/me**: Update profile (e.g., displayName, avatarUrl) (auth required).
- **POST /api/users/sync-profile**: Sync or create user profile with defaults (auth required).

### Friends Routes
- **POST /api/friends/request**: Send friend request by username (auth required).
- **POST /api/friends/accept**: Accept friend request (auth required).
- **GET /api/friends/requests**: List incoming requests (auth required).
- **GET /api/friends**: List friends (auth required).

### Messaging Routes
- **POST /api/messages**: Send message (auth required).
- **GET /api/messages/:conversationId**: List messages with pagination (auth required).

### Presence Routes
- **POST /api/presence**: Update presence in RTDB (auth required).

### Socket.IO Events
- **authenticate(token)**: Authenticate and set RTDB presence.
- **join_conv(conversationId)**: Join conversation room.
- **send_message(data)**: Send message (broadcasted as receive_message).
- **receive_message(data)**: Receive new messages in real-time.

## Setup Instructions

1. **Install Dependencies:**

2. **Configure Environment:**
- Set up `.env` with Firebase credentials and RTDB URL.

3. **Run the Server:**

4. **Test Databases:**
- Use `test-firebase.js` to verify Firestore and RTDB writes/reads.

## Technologies
- Node.js, Express.js
- Firebase (Auth, Firestore, Realtime Database)
- Socket.IO

## License
MIT License. See [LICENSE](LICENSE) for details.

---

For contributions or issues, open a pull request or issue on this repo.
