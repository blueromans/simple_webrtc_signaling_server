const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    transports: ['websocket', 'polling'],
  },
});

// Store room users
const rooms = new Map();

io.on('connection', socket => {
  console.log('User connected:', socket.id);
  
  socket.on('join-room', data => {
    const { room, userId } = data;
    const roomId = typeof data === 'string' ? data : room; // Support both formats
    const userIdentifier = userId || socket.id;
    
    socket.join(roomId);
    
    // Track users in room
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add({ socketId: socket.id, userId: userIdentifier });
    
    console.log(`User ${socket.id} (${userIdentifier}) joined room ${roomId}`);
    console.log(`Room ${roomId} now has ${rooms.get(roomId).size} users`);
    
    // Notify others in room that a user joined
    socket.to(roomId).emit('user-joined', {
      userId: userIdentifier,
      socketId: socket.id,
      room: roomId,
    });
    
    // Send current room users to the new joiner
    const roomUsers = Array.from(rooms.get(roomId)).map(user => ({
      userId: user.userId,
      socketId: user.socketId,
    }));
    
    socket.emit('room-users', {
      room: roomId,
      users: roomUsers,
      count: roomUsers.length,
    });
  });
  
  socket.on('offer', data => {
    console.log(`Relaying offer from ${socket.id} to room ${data.room}`);
    socket.to(data.room).emit('offer', {
      offer: data.offer,
      from: data.from || socket.id,
      room: data.room,
    });
  });
  
  socket.on('answer', data => {
    console.log(`Relaying answer from ${socket.id} to room ${data.room}`);
    socket.to(data.room).emit('answer', {
      answer: data.answer,
      from: data.from || socket.id,
      room: data.room,
    });
  });
  
  socket.on('ice-candidate', data => {
    console.log(`Relaying ICE candidate from ${socket.id} to room ${data.room}`);
    socket.to(data.room).emit('ice-candidate', {
      candidate: data.candidate,
      from: data.from || socket.id,
      room: data.room,
    });
  });
  
  socket.on('request-call-initiation', data => {
    console.log(`Call initiation request from ${socket.id} in room ${data.room}`);
    socket.to(data.room).emit('request-call-initiation', {
      from: data.from || socket.id,
      room: data.room,
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove user from all rooms
    for (const [roomId, users] of rooms.entries()) {
      const userArray = Array.from(users);
      const updatedUsers = userArray.filter(user => user.socketId !== socket.id);
      
      if (updatedUsers.length === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      } else {
        rooms.set(roomId, new Set(updatedUsers));
        console.log(`User ${socket.id} removed from room ${roomId}`);
        
        // Notify remaining users
        socket.to(roomId).emit('user-left', {
          socketId: socket.id,
          room: roomId,
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('WebRTC signaling server ready');
});
