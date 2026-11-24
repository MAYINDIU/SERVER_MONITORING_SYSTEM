const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

let io = null;

/** Attach Socket.IO to the HTTP server. Only logged-in dashboard users may connect. */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','), credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, env.jwtSecret);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('dashboard');
    // clients viewing a single server can subscribe to its room (not required – all events go to dashboard)
    socket.on('watch', (serverId) => socket.join(`server:${serverId}`));
    socket.on('unwatch', (serverId) => socket.leave(`server:${serverId}`));
  });

  return io;
}

const emit = (event, payload) => {
  if (io) io.to('dashboard').emit(event, payload);
};

module.exports = { initSocket, emit };
