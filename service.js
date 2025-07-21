const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
require('dotenv').config();
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('MongoDB connection error:', err));

// Import models
const User = require('./models/User');
const Message = require('./models/Message');
const Chat = require('./models/Chat');
const Group = require('./models/Group');
const Presence = require('./models/Presence');


// Import routes
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friendRoutes');
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);


// Socket.IO logic
require('./socket')(io);

app.get('/', (req, res) => {
    const apiRoutes = {
        message: "Welcome to the Chat App API",
        version: "1.0.0",
        routes: {
            authentication: [
                {
                    path: "/api/auth/register",
                    method: "POST",
                    description: "Registers a new user.",
                    body: {
                        username: "String",
                        email: "String",
                        password: "String",
                        displayName: "String (optional)"
                    }
                },
                {
                    path: "/api/auth/login",
                    method: "POST",
                    description: "Logs in a user and returns a JWT.",
                    body: {
                        usernameOrEmail: "String",
                        password: "String"
                    }
                }
            ],
            messages: [
                {
                    path: "/api/messages",
                    method: "GET",
                    description: "Fetches all messages for a chat (requires authentication).",
                    headers: "Authorization: Bearer <token>",
                    queryParams: "?chatId=<chat_id>"
                },
                {
                    path: "/api/messages",
                    method: "POST",
                    description: "Sends a new message (requires authentication).",
                    headers: "Authorization: Bearer <token>",
                    body: {
                        chatId: "String",
                        content: "String"
                    }
                }
            ],
            friends: [
                {
                    path: "/api/friends",
                    method: "GET",
                    description: "Get the list of friends for the authenticated user.",
                    headers: "Authorization: Bearer <token>"
                },
                {
                    path: "/api/friends/requests",
                    method: "GET",
                    description: "Get pending friend requests for the authenticated user.",
                    headers: "Authorization: Bearer <token>"
                },
                {
                    path: "/api/friends/request",
                    method: "POST",
                    description: "Send a friend request to another user by their username.",
                    headers: "Authorization: Bearer <token>",
                    body: {
                        username: "String"
                    }
                },
                {
                    path: "/api/friends/accept",
                    method: "POST",
                    description: "Accept a pending friend request from another user.",
                    headers: "Authorization: Bearer <token>",
                    body: {
                        requesterId: "String"
                    }
                }
            ]
        },
        sockets: {
            description: "Real-time communication is handled via Socket.IO.",
            events: {
                "sendMessage": "Emitted when a user sends a message.",
                "typing": "Emitted when a user is typing.",
                "stopTyping": "Emitted when a user stops typing."
            }
        }
    };
    res.json(apiRoutes);
});


server.listen(3000, () => console.log('Server running on port http://localhost:3000'));
