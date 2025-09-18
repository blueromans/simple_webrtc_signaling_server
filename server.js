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
io.on('connection', socket => {
  console.log('User connected:', socket.id);
  socket.on('join-room', roomId => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });
  socket.on('offer', data => {
    socket.to(data.room).emit('offer', {
      offer: data.offer,
      from: socket.id,
    });
  });
  socket.on('answer', data => {
    socket.to(data.room).emit('answer', {
      answer: data.answer,
      from: socket.id,
    });
  });
  socket.on('ice-candidate', data => {
    socket.to(data.room).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id,
    });
  });
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
