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
    playerNames: { [id: string]: string };
    spectators: string[];
    gameState: {
      turn: number; // 0 or 1
      letters: [string[], string[]]; // Player 1 letters, Player 2 letters
      phase: 'setting' | 'replicating' | 'evaluating' | 'intermission';
      timer: number;
      lastActionTime: number;
      message?: string | null;
      eAttempts: [number, number];
    }
  }>();

  const startIntermission = (roomId: string, nextPhase: 'setting' | 'replicating' = 'setting') => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.gameState.phase = 'intermission';
    room.gameState.timer = 10;
    io.to(roomId).emit('state-update', room.gameState);

    // Countdown on server for intermission
    let count = 10;
    const interval = setInterval(() => {
      const r = rooms.get(roomId);
      if (!r || r.gameState.phase !== 'intermission') {
        clearInterval(interval);
        return;
      }
      count--;
      r.gameState.timer = count;
      if (count <= 0) {
        clearInterval(interval);
        r.gameState.phase = nextPhase;
        r.gameState.timer = 30;
        r.gameState.message = null;
        io.to(roomId).emit('state-update', r.gameState);
      } else {
        io.to(roomId).emit('state-update', r.gameState);
      }
    }, 1000);
  };

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, role, playerName }: { roomId: string, role: 'player' | 'spectator', playerName?: string }) => {
      const room = rooms.get(roomId) || {
        players: [],
        playerNames: {},
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
          room.playerNames[socket.id] = playerName || 'Skater';
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
        playerNames: room.playerNames,
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

      const currentTurn = room.gameState.turn;
      const otherPlayerIndex = 1 - currentTurn;
      const phase = room.gameState.phase;
      
      // result: 'valid' | 'invalid' | 'repeat'
      
      if (phase === 'setting') {
        // Opponent is judging the setter
        if (result === 'valid') {
          // Setter successfully set a trick, move to replication
          room.gameState.phase = 'replicating';
          room.gameState.message = null;
          room.gameState.timer = 30;
          io.to(roomId).emit('state-update', room.gameState);
        } else if (result === 'invalid') {
          // Setter failed, turn switches
          room.gameState.turn = otherPlayerIndex;
          startIntermission(roomId, 'setting');
        }
        // If repeat, stay in setting
      } else if (phase === 'replicating') {
        // Setter is judging the replicator
        const replicatorIndex = otherPlayerIndex;
        
        if (result === 'valid') {
          // Replicator landed it, no letter, setter continues by setting next trick
          startIntermission(roomId, 'setting');
          room.gameState.eAttempts[replicatorIndex] = 0;
        } else if (result === 'invalid') {
          const letters = ['S', 'K', 'A', 'T', 'E'];
          const currentLetters = room.gameState.letters[replicatorIndex];
          
          if (currentLetters.length < 4) {
            // Normal letters S, K, A, T
            currentLetters.push(letters[currentLetters.length]);
            startIntermission(roomId, 'setting');
          } else if (currentLetters.length === 4) {
            // Special logic for the final letter E - ONLY for the REPLICATOR
            if (room.gameState.eAttempts[replicatorIndex] === 0) {
              // First fail on E: give an extra chance in the same turn
              room.gameState.eAttempts[replicatorIndex] = 1;
              room.gameState.timer = 30;
              io.to(roomId).emit('state-update', room.gameState);
              // Stay in replicating phase for the second chance
            } else {
              // Second fail on E: assign letter and end game
              currentLetters.push('E');
              room.gameState.eAttempts[replicatorIndex] = 0;
              startIntermission(roomId, 'setting');
            }
          }
        }
        // If repeat, stay in replicating
      }
    });

    socket.on('timer-out', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const letters = ['S', 'K', 'A', 'T', 'E'];
      const currentTurn = room.gameState.turn;
      const otherPlayerIndex = 1 - currentTurn;
      const phase = room.gameState.phase;
      
      let penalizedPlayerIndex;
      let shouldSwitchTurn = false;
      let nextPhase = 'setting';

      if (phase === 'setting') {
        // Setter timed out
        penalizedPlayerIndex = currentTurn;
        shouldSwitchTurn = true; // Setter loses turn
        nextPhase = 'setting';
      } else {
        // Replicator timed out
        penalizedPlayerIndex = otherPlayerIndex;
        shouldSwitchTurn = false; // Setter (currentTurn) keeps turn
        nextPhase = 'setting';

        const currentLetters = room.gameState.letters[penalizedPlayerIndex];
        if (currentLetters.length < 4) {
          currentLetters.push(letters[currentLetters.length]);
        } else if (currentLetters.length === 4) {
          // Special logic for the final letter E - ONLY for the REPLICATOR
          if (room.gameState.eAttempts[penalizedPlayerIndex] === 0) {
            room.gameState.eAttempts[penalizedPlayerIndex] = 1;
            nextPhase = 'replicating'; // Same turn, second attempt
          } else {
            currentLetters.push('E');
            room.gameState.eAttempts[penalizedPlayerIndex] = 0;
            room.gameState.message = null;
          }
        }
      }

      if (shouldSwitchTurn) {
        room.gameState.turn = 1 - room.gameState.turn;
      }
      
      room.gameState.message = "Time ran out";
      startIntermission(roomId, nextPhase as any);
      
      // Clear message after 3 seconds
      setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (currentRoom && currentRoom.gameState.message === "Time ran out") {
          currentRoom.gameState.message = null;
          io.to(roomId).emit('state-update', currentRoom.gameState);
        }
      }, 3000);
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
