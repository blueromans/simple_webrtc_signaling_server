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

  // Store room users and their states
  const rooms = new Map();
  const userStates = new Map();

  // Helper function to get room users
  const getRoomUsers = (roomId) => {
    if (!rooms.has(roomId)) {
      return [];
    }
    return Array.from(rooms.get(roomId)).map(user => ({
      userId: user.userId,
      socketId: user.socketId,
      cameraEnabled: userStates.get(user.socketId)?.cameraEnabled || false,
      micEnabled: userStates.get(user.socketId)?.micEnabled || false,
    }));
  };

  // Helper function to broadcast to room except sender
  const broadcastToRoom = (roomId, eventName, data, excludeSocketId) => {
    const roomUsers = rooms.get(roomId);
    if (roomUsers) {
      roomUsers.forEach(user => {
        if (user.socketId !== excludeSocketId) {
          io.to(user.socketId).emit(eventName, data);
        }
      });
    }
  };

  io.on('connection', socket => {
    console.log('User connected:', socket.id);

    // Initialize user state
    userStates.set(socket.id, {
      cameraEnabled: true,
      micEnabled: true,
      roomId: null,
    });

    socket.on('join-room', data => {
      const roomId = typeof data === 'string' ? data : (data.room || data.roomId);
      const userId = data.userId || socket.id;

      // Leave previous room if any
      const currentState = userStates.get(socket.id);
      if (currentState?.roomId) {
        socket.leave(currentState.roomId);
        const prevRoom = rooms.get(currentState.roomId);
        if (prevRoom) {
          prevRoom.delete(socket.id);
        }
      }

      // Join new room
      socket.join(roomId);

      // Track users in room
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      rooms.get(roomId).add({ socketId: socket.id, userId });

      // Update user state
      userStates.set(socket.id, { ...currentState, roomId });

      console.log(`User ${socket.id} (${userId}) joined room ${roomId}`);
      console.log(`Room ${roomId} now has ${rooms.get(roomId).size} users`);

      // Notify others in room that a user joined
      socket.to(roomId).emit('user-joined', {
        userId,
        socketId: socket.id,
        room: roomId,
      });

      // Send current room users to the new joiner
      socket.emit('room-users', {
        room: roomId,
        users: getRoomUsers(roomId),
        count: rooms.get(roomId).size,
      });
    });

    // WebRTC signaling
    socket.on('offer', data => {
      const roomId = data.room || data.roomId;
      console.log(`Relaying offer from ${socket.id} to room ${roomId}`);
      socket.to(roomId).emit('offer', {
        ...data,
        from: socket.id,
      });
    });

    socket.on('answer', data => {
      const roomId = data.room || data.roomId;
      console.log(`Relaying answer from ${socket.id} to room ${roomId}`);
      socket.to(roomId).emit('answer', {
        ...data,
        from: socket.id,
      });
    });

    socket.on('ice-candidate', data => {
      const roomId = data.room || data.roomId;
      socket.to(roomId).emit('ice-candidate', {
        ...data,
        from: socket.id,
      });
    });

    // Camera and microphone state management
    socket.on('camera-state', data => {
      const roomId = data.room || data.roomId;
      const state = userStates.get(socket.id);
      if (state) {
        state.cameraEnabled = data.enabled;
        userStates.set(socket.id, state);
      }

      socket.to(roomId).emit('camera-state', {
        enabled: data.enabled,
        from: socket.id,
        userId: data.userId || socket.id,
      });
    });

    socket.on('mic-state', data => {
      const roomId = data.room || data.roomId;
      const state = userStates.get(socket.id);
      if (state) {
        state.micEnabled = data.enabled;
        userStates.set(socket.id, state);
      }

      socket.to(roomId).emit('mic-state', {
        enabled: data.enabled,
        from: socket.id,
        userId: data.userId || socket.id,
      });
    });

    socket.on('request-camera-state', data => {
      const roomId = data.room || data.roomId;
      const state = userStates.get(socket.id);
      if (state) {
        socket.to(roomId).emit('camera-state', {
          enabled: state.cameraEnabled,
          from: socket.id,
        });
      }
    });

    // Chat messaging (can work with or without WebRTC data channels)
    socket.on('chat-message', data => {
      const roomId = data.room || data.roomId;
      const message = {
        id: Date.now().toString(),
        text: data.text,
        sender: data.sender || socket.id,
        timestamp: new Date().toISOString(),
        ...data,
      };

      // Broadcast message to all users in the room except sender
      socket.to(roomId).emit('chat-message', message);

      // Echo back to sender with confirmation
      socket.emit('chat-message-sent', {
        ...message,
        status: 'sent',
      });
    });

    // Typing indicators
    socket.on('typing', data => {
      const roomId = data.room || data.roomId;
      socket.to(roomId).emit('typing', {
        userId: data.userId || socket.id,
        isTyping: data.isTyping !== false,
      });
    });

    // File sharing support
    socket.on('file-share', data => {
      const roomId = data.room || data.roomId;
      socket.to(roomId).emit('file-share', {
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileType: data.fileType,
        fileUrl: data.fileUrl,
        sender: data.sender || socket.id,
        timestamp: new Date().toISOString(),
      });
    });

    // Room management
    socket.on('leave-room', data => {
      const roomId = data.room || data.roomId;
      handleUserLeaveRoom(socket, roomId);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);

      // Get user's room and clean up
      const state = userStates.get(socket.id);
      if (state?.roomId) {
        handleUserLeaveRoom(socket, state.roomId);
      }

      // Clean up user state
      userStates.delete(socket.id);
    });

    socket.on('error', error => {
      console.error('Socket error:', error);
    });
  });

  // Helper function to handle user leaving room
  function handleUserLeaveRoom(socket, roomId) {
    socket.leave(roomId);

    const room = rooms.get(roomId);
    if (room) {
      // Find and remove user from room
      let userId;
      room.forEach(user => {
        if (user.socketId === socket.id) {
          userId = user.userId;
          room.delete(user);
        }
      });

      // Clean up empty rooms
      if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} is empty, cleaning up`);
      } else {
        // Notify remaining users
        socket.to(roomId).emit('user-disconnected', {
          userId: userId || socket.id,
          socketId: socket.id,
          room: roomId,
        });

        // Send updated room users to remaining participants
        broadcastToRoom(roomId, 'room-users', {
          room: roomId,
          users: getRoomUsers(roomId),
          count: room.size,
        }, socket.id);
      }

      console.log(`User ${socket.id} left room ${roomId}`);
      if (room) {
        console.log(`Room ${roomId} now has ${room.size} users`);
      }
    }
  }

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      rooms: rooms.size,
      users: userStates.size,
    });
  });

  // Room info endpoint (for debugging)
  app.get('/rooms/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const room = rooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      roomId,
      users: getRoomUsers(roomId),
      count: room.size,
    });
  });

  const PORT = process.env.PORT || 3000;

  server.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
