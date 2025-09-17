const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { randomUUID } = require('crypto');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static('public'));

// Route for admin page
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Setup - Team Challenge</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js"></script>
    <style>
        body { background: #0a0a0a; color: #e5e5e5; }
    </style>
</head>
<body>
    <div class="min-h-screen p-8">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-4xl font-bold mb-8">👨‍💼 Admin Setup</h1>
            
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <!-- Event Creation Form -->
                <div class="bg-gray-800 p-6 rounded-lg">
                    <h2 class="text-2xl font-bold mb-4">Event erstellen</h2>
                    <form id="eventForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium mb-2">Event Name</label>
                            <input type="text" id="eventName" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg" placeholder="Mein Team Challenge" required>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium mb-2">Countdown (Sekunden)</label>
                            <input type="number" id="countdownSec" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg" value="600" required>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium mb-2">Modus</label>
                            <div class="space-y-2">
                                <label class="flex items-center">
                                    <input type="radio" name="mode" value="shared" checked class="mr-2">
                                    Shared Mode (alle Teams gleiche Fragen)
                                </label>
                                <label class="flex items-center">
                                    <input type="radio" name="mode" value="individual" class="mr-2">
                                    Individual Mode (jedes Team eigene Fragen)
                                </label>
                            </div>
                        </div>
                        
                        <div id="sharedMode">
                            <div>
                                <label class="block text-sm font-medium mb-2">Finaler Code</label>
                                <input type="text" id="finalCode" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg" placeholder="FINAL123">
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium mb-2">Level 1 Code</label>
                                <input type="text" id="level1Code" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg" placeholder="LEVEL1">
                            </div>
                        </div>
                        
                        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg">
                            Event erstellen
                        </button>
                    </form>
                </div>
                
                <!-- QR Code & Links -->
                <div class="bg-gray-800 p-6 rounded-lg">
                    <h2 class="text-2xl font-bold mb-4">Event Links</h2>
                    <div id="eventLinks" class="space-y-4" style="display: none;">
                        <div>
                            <label class="block text-sm font-medium mb-2">Join Link</label>
                            <input type="text" id="joinLink" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg" readonly>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium mb-2">QR Code</label>
                            <div id="qrcode" class="flex justify-center"></div>
                        </div>
                        
                        <div class="space-y-2">
                            <a id="beamerLink" href="#" class="block bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg text-center">
                                📺 Beamer Ansicht
                            </a>
                            <a id="arenaLink" href="#" class="block bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-center">
                                🏟️ Arena Ansicht
                            </a>
                            <a id="highscoreLink" href="#" class="block bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg text-center">
                                🏆 Highscore
                            </a>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Countdown Controls -->
            <div id="countdownControls" class="mt-8 bg-gray-800 p-6 rounded-lg" style="display: none;">
                <h2 class="text-2xl font-bold mb-4">Countdown Kontrolle</h2>
                <div class="flex space-x-4">
                    <button id="startBtn" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg">
                        ▶️ Start
                    </button>
                    <button id="pauseBtn" class="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg">
                        ⏸️ Pause
                    </button>
                    <button id="resumeBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
                        ▶️ Resume
                    </button>
                    <button id="resetBtn" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">
                        🔄 Reset
                    </button>
                </div>
                <div id="countdownDisplay" class="mt-4 text-3xl font-bold text-center"></div>
            </div>
        </div>
    </div>

    <script>
        let ws = null;
        let currentEventId = null;
        let countdownInterval = null;

        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}\`;
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                ws.send(JSON.stringify({ type: 'hello', role: 'admin' }));
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'event_created') {
                    currentEventId = data.eventId;
                    showEventLinks(data.eventId);
                } else if (data.type === 'state') {
                    updateCountdown(data.payload.countdown);
                }
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setTimeout(connectWebSocket, 1000);
            };
        }

        function showEventLinks(eventId) {
            const baseUrl = window.location.origin;
            const joinUrl = \`\${baseUrl}/join/\${eventId}\`;
            
            document.getElementById('joinLink').value = joinUrl;
            document.getElementById('beamerLink').href = \`\${baseUrl}/beamer/\${eventId}\`;
            document.getElementById('arenaLink').href = \`\${baseUrl}/arena/\${eventId}\`;
            document.getElementById('highscoreLink').href = \`\${baseUrl}/highscore/\${eventId}\`;
            
            // Generate QR Code
            const qrDiv = document.getElementById('qrcode');
            qrDiv.innerHTML = '';
            QRCode.toCanvas(qrDiv, joinUrl, { width: 200, color: { light: '#000000' } });
            
            document.getElementById('eventLinks').style.display = 'block';
            document.getElementById('countdownControls').style.display = 'block';
        }

        function updateCountdown(countdown) {
            const display = document.getElementById('countdownDisplay');
            const minutes = Math.floor(countdown.remainingMs / 60000);
            const seconds = Math.floor((countdown.remainingMs % 60000) / 1000);
            display.textContent = \`\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
        }

        function sendCountdownControl(action) {
            if (ws && currentEventId) {
                ws.send(JSON.stringify({ type: 'countdown_control', action }));
            }
        }

        // Event Listeners
        document.getElementById('eventForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const formData = {
                name: document.getElementById('eventName').value,
                countdownSec: parseInt(document.getElementById('countdownSec').value),
                mode: document.querySelector('input[name="mode"]:checked').value,
                finalCode: document.getElementById('finalCode').value,
                levels: [
                    { index: 0, prompt: "Level 1", code: document.getElementById('level1Code').value }
                ]
            };
            
            ws.send(JSON.stringify({ type: 'create_event', payload: formData }));
        });

        document.getElementById('startBtn').addEventListener('click', () => sendCountdownControl('start'));
        document.getElementById('pauseBtn').addEventListener('click', () => sendCountdownControl('pause'));
        document.getElementById('resumeBtn').addEventListener('click', () => sendCountdownControl('resume'));
        document.getElementById('resetBtn').addEventListener('click', () => sendCountdownControl('reset'));

        // Mode switching
        document.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                document.getElementById('sharedMode').style.display = e.target.value === 'shared' ? 'block' : 'none';
            });
        });

        // Connect on load
        connectWebSocket();
    </script>
</body>
</html>
  `);
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
