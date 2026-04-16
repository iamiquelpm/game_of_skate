import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Room state
  const rooms = new Map<string, {
    players: string[];
    spectators: string[];
    gameState: {
      turn: number; // 0 or 1
      letters: [string[], string[]]; // Player 1 letters, Player 2 letters
      phase: 'setting' | 'replicating' | 'evaluating';
      timer: number;
      lastActionTime: number;
      message?: string | null;
      eAttempts: [number, number];
    }
  }>();

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, role }: { roomId: string, role: 'player' | 'spectator' }) => {
      const room = rooms.get(roomId) || {
        players: [],
        spectators: [],
        gameState: {
          turn: 0,
          letters: [[], []],
          phase: 'setting',
          timer: 30,
          lastActionTime: Date.now(),
          eAttempts: [0, 0]
        }
      };

      if (role === 'player') {
        if (room.players.length >= 2) {
          socket.emit('error', 'Room is full of players. Join as spectator?');
          return;
        }
        if (!room.players.includes(socket.id)) {
          room.players.push(socket.id);
        }
      } else {
        if (!room.spectators.includes(socket.id)) {
          room.spectators.push(socket.id);
        }
      }

      rooms.set(roomId, room);
      socket.join(roomId);

      console.log(`User ${socket.id} joined room ${roomId} as ${role}. Players: ${room.players.length}`);

      // Broadcast updated room info to everyone in the room
      const roomUpdate = {
        players: room.players,
        spectators: room.spectators,
        gameState: room.gameState
      };

      io.to(roomId).emit('room-update', roomUpdate);

      // Also notify about specific user joining for WebRTC
      socket.to(roomId).emit('user-joined', { userId: socket.id, role });

      if (room.players.length === 2) {
        console.log(`Game starting in room ${roomId}`);
        io.to(roomId).emit('game-start', roomUpdate);
      }
    });

    // Signaling for WebRTC (Targeted)
    socket.on('offer', ({ roomId, targetId, offer }) => {
      if (targetId) {
        io.to(targetId).emit('offer', { fromId: socket.id, offer });
      } else {
        socket.to(roomId).emit('offer', { fromId: socket.id, offer });
      }
    });

    socket.on('answer', ({ roomId, targetId, answer }) => {
      if (targetId) {
        io.to(targetId).emit('answer', { fromId: socket.id, answer });
      } else {
        socket.to(roomId).emit('answer', { fromId: socket.id, answer });
      }
    });

    socket.on('ice-candidate', ({ roomId, targetId, candidate }) => {
      if (targetId) {
        io.to(targetId).emit('ice-candidate', { fromId: socket.id, candidate });
      } else {
        socket.to(roomId).emit('ice-candidate', { fromId: socket.id, candidate });
      }
    });

    // Game Actions
    socket.on('trick-set', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      room.gameState.phase = 'replicating';
      room.gameState.lastActionTime = Date.now();
      room.gameState.timer = 30;
      room.gameState.message = null;

      io.to(roomId).emit('state-update', room.gameState);
    });

    socket.on('evaluate-trick', ({ roomId, result }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      let shouldSwitchTurn = result !== 'repeat';
      const otherPlayerIndex = 1 - room.gameState.turn;

      // result: 'valid' | 'invalid' | 'repeat'
      if (result === 'invalid') {
        const letters = ['S', 'K', 'A', 'T', 'E'];
        const currentLetters = room.gameState.letters[otherPlayerIndex];
        
        if (currentLetters.length < 4) {
          // Normal letters S, K, A, T
          currentLetters.push(letters[currentLetters.length]);
        } else if (currentLetters.length === 4) {
          // Special logic for the final letter E
          if (room.gameState.eAttempts[otherPlayerIndex] === 0) {
            // First fail on E: give an extra chance in the same turn
            room.gameState.eAttempts[otherPlayerIndex] = 1;
            shouldSwitchTurn = false; // Stay on the same turn for second attempt
          } else {
            // Second fail on E: assign letter and end game
            currentLetters.push('E');
            room.gameState.message = null;
          }
        }
      } else if (result === 'valid') {
        // Reset eAttempts on success
        room.gameState.eAttempts[otherPlayerIndex] = 0;
        room.gameState.message = null;
      }

      if (shouldSwitchTurn) {
        // Switch turn
        room.gameState.turn = 1 - room.gameState.turn;
        room.gameState.phase = 'setting';
      } else {
        // Stay in replicating phase for second attempt or repeat
        room.gameState.phase = 'replicating';
      }

      room.gameState.lastActionTime = Date.now();
      room.gameState.timer = 30;

      io.to(roomId).emit('state-update', room.gameState);
    });

    socket.on('timer-out', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const letters = ['S', 'K', 'A', 'T', 'E'];
      let penalizedPlayerIndex;
      let shouldSwitchTurn = true;

      if (room.gameState.phase === 'replicating') {
        // The player matching the trick (1 - turn) timed out
        penalizedPlayerIndex = 1 - room.gameState.turn;
      } else {
        // The player setting the trick (turn) timed out
        penalizedPlayerIndex = room.gameState.turn;
      }

      const currentLetters = room.gameState.letters[penalizedPlayerIndex];
      if (currentLetters.length < 4) {
        currentLetters.push(letters[currentLetters.length]);
      } else if (currentLetters.length === 4) {
        if (room.gameState.eAttempts[penalizedPlayerIndex] === 0) {
          room.gameState.eAttempts[penalizedPlayerIndex] = 1;
          shouldSwitchTurn = false;
        } else {
          currentLetters.push('E');
          room.gameState.message = null;
        }
      }

      if (shouldSwitchTurn) {
        room.gameState.turn = 1 - room.gameState.turn;
        room.gameState.phase = 'setting';
      } else {
        // Stay in current phase for second attempt
      }

      room.gameState.lastActionTime = Date.now();
      room.gameState.timer = 30;
      
      if (shouldSwitchTurn && !room.gameState.message) {
        room.gameState.message = "Time ran out — letter assigned";
      }
      
      io.to(roomId).emit('state-update', room.gameState);
      
      // Clear message after 3 seconds if it's the timeout message
      if (room.gameState.message === "Time ran out — letter assigned") {
        setTimeout(() => {
          const currentRoom = rooms.get(roomId);
          if (currentRoom && currentRoom.gameState.message === "Time ran out — letter assigned") {
            currentRoom.gameState.message = null;
            io.to(roomId).emit('state-update', currentRoom.gameState);
          }
        }, 3000);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      // Clean up rooms
      for (const [roomId, room] of rooms.entries()) {
        if (room.players.includes(socket.id)) {
          console.log(`Player ${socket.id} left room ${roomId}. Closing room.`);
          io.to(roomId).emit('player-disconnected');
          rooms.delete(roomId);
        } else if (room.spectators.includes(socket.id)) {
          console.log(`Spectator ${socket.id} left room ${roomId}`);
          room.spectators = room.spectators.filter(id => id !== socket.id);
          io.to(roomId).emit('room-update', {
            players: room.players,
            spectators: room.spectators,
            gameState: room.gameState
          });
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
