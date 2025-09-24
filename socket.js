module.exports = (io) => {

    io.on('connection', (socket) => {

        console.log('User connected:', socket.id);

        // Join a room for direct messaging (room name can be userId)
        socket.on('join', (userId) => {
            socket.join(userId);
            console.log(`User ${userId} joined their room`);
        });

        // Listen for new messages sent via Socket.IO
        socket.on('send_message', async (data) => {
            // data: { recipientId, content, chatType, senderId }
            io.to(data.recipientId).emit('receive_message', data);
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });

    });

};
