const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { randomUUID } = require('crypto');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static('public'));

// Route for admin page
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// Simple in-memory storage
const rooms = new Map();

// WebSocket connection handling
wss.on('connection', (socket) => {
  let meta = { socket, role: 'admin' };

  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'hello') {
        meta.role = msg.role;
        meta.eventId = msg.eventId;
        meta.teamName = msg.teamName;
        
        if (msg.eventId) {
          if (!rooms.has(msg.eventId)) {
            rooms.set(msg.eventId, { clients: new Set(), state: null });
          }
          rooms.get(msg.eventId).clients.add(meta);
        }
      }
      
      if (msg.type === 'create_event') {
        const eventId = randomUUID();
        const event = {
          id: eventId,
          name: msg.payload.name,
          countdownSec: msg.payload.countdownSec,
          mode: msg.payload.mode || 'shared',
          levels: msg.payload.levels || [],
          teamLevels: msg.payload.teamLevels || [],
          finalCode: msg.payload.finalCode || '',
          caseInsensitive: msg.payload.caseInsensitive || false,
          createdAt: Date.now()
        };
        
        const room = { clients: new Set(), state: { event, teams: [], countdown: { startedAtMs: null, pausedAtMs: null, remainingMs: event.countdownSec * 1000, isRunning: false } } };
        rooms.set(eventId, room);
        room.clients.add(meta);
        meta.eventId = eventId;
        
        socket.send(JSON.stringify({ type: 'event_created', eventId }));
      }
      
      if (msg.type === 'countdown_control' && meta.eventId) {
        const room = rooms.get(meta.eventId);
        if (room && room.state) {
          const cd = room.state.countdown;
          const totalDuration = room.state.event.countdownSec * 1000;
          
          if (msg.action === 'start') {
            cd.startedAtMs = Date.now();
            cd.pausedAtMs = null;
            cd.isRunning = true;
            cd.remainingMs = totalDuration;
          } else if (msg.action === 'pause' && cd.isRunning) {
            cd.pausedAtMs = Date.now();
            cd.isRunning = false;
            cd.remainingMs = Math.max(0, totalDuration - (cd.pausedAtMs - cd.startedAtMs));
          } else if (msg.action === 'resume' && !cd.isRunning) {
            cd.startedAtMs = Date.now() - (totalDuration - cd.remainingMs);
            cd.pausedAtMs = null;
            cd.isRunning = true;
          } else if (msg.action === 'reset') {
            cd.startedAtMs = null;
            cd.pausedAtMs = null;
            cd.isRunning = false;
            cd.remainingMs = totalDuration;
          }
          
          // Broadcast to all clients
          room.clients.forEach(client => {
            if (client.socket.readyState === 1) {
              client.socket.send(JSON.stringify({ type: 'state', payload: room.state }));
            }
          });
        }
      }
      
      if (msg.type === 'submit_answer' && meta.eventId) {
        const room = rooms.get(meta.eventId);
        if (room && room.state) {
          const team = room.state.teams.find(t => t.id === meta.teamId);
          if (team) {
            const event = room.state.event;
            let isCorrect = false;
            
            if (event.mode === 'shared') {
              if (team.currentLevel < event.levels.length) {
                isCorrect = normalizeCode(msg.payload.code) === normalizeCode(event.levels[team.currentLevel].code);
              } else {
                isCorrect = normalizeCode(msg.payload.code) === normalizeCode(event.finalCode);
              }
            } else {
              const teamConfig = event.teamLevels.find(tl => tl.teamId === team.id);
              if (teamConfig) {
                if (team.currentLevel < teamConfig.levels.length) {
                  isCorrect = normalizeCode(msg.payload.code) === normalizeCode(teamConfig.levels[team.currentLevel].code);
                } else {
                  isCorrect = normalizeCode(msg.payload.code) === normalizeCode(teamConfig.finalCode);
                }
              }
            }
            
            if (isCorrect) {
              team.currentLevel++;
              team.solvedCount++;
              
              const totalLevels = event.mode === 'shared' ? event.levels.length + 1 : (event.teamLevels.find(tl => tl.teamId === team.id)?.levels.length || 0) + 1;
              if (team.currentLevel >= totalLevels) {
                team.finished = true;
                team.elapsedMs = Date.now() - team.joinedAt;
              }
            }
            
            // Broadcast updated state
            room.clients.forEach(client => {
              if (client.socket.readyState === 1) {
                client.socket.send(JSON.stringify({ type: 'state', payload: room.state }));
              }
            });
          }
        }
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  socket.on('close', () => {
    if (meta.eventId) {
      const room = rooms.get(meta.eventId);
      if (room) room.clients.delete(meta);
    }
  });
});

// Countdown ticker
setInterval(() => {
  rooms.forEach((room, eventId) => {
    if (room.state && room.state.countdown.isRunning) {
      const cd = room.state.countdown;
      const totalDuration = room.state.event.countdownSec * 1000;
      const elapsed = Date.now() - cd.startedAtMs;
      cd.remainingMs = Math.max(0, totalDuration - elapsed);
      
      if (cd.remainingMs <= 0) {
        cd.isRunning = false;
        cd.remainingMs = 0;
      }
      
      // Broadcast to all clients
      room.clients.forEach(client => {
        if (client.socket.readyState === 1) {
          client.socket.send(JSON.stringify({ type: 'state', payload: room.state }));
        }
      });
    }
  });
}, 100);

function normalizeCode(code) {
  return code.replace(/\s/g, '');
}

const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
