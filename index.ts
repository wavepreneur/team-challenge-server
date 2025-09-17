import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  AnyFromClient,
  AnyFromServer,
  ClientHelloMsg,
  CountdownControlMsg,
  CreateEventMsg,
  EventConfig,
  EventState,
  ServerEventIdMsg,
  ServerStateMsg,
  SubmitAnswerMsg,
  TeamState,
} from '../src/lib/shared-types';

// In-memory store for events and their states
type ClientMeta = {
  socket: WebSocket;
  role: 'admin' | 'team' | 'beamer';
  eventId?: string;
  teamId?: string;
};

type Room = {
  clients: Set<ClientMeta>;
  state: EventState | null;
};

const rooms = new Map<string, Room>();

function getOrCreateRoom(eventId: string): Room {
  if (!rooms.has(eventId)) {
    rooms.set(eventId, { clients: new Set(), state: null });
  }
  return rooms.get(eventId)!;
}

function emitState(eventId: string) {
  const room = rooms.get(eventId);
  if (!room || !room.state) return;

  const msg: ServerStateMsg = { type: 'state', payload: room.state };
  const json = JSON.stringify(msg);

  for (const client of room.clients) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(json);
    }
  }
}

function normalizeCode(code: string): string {
  return code.replace(/\s/g, '');
}

export function startServer(port: number) {
  // Create HTTP server for static files
  const server = createServer((req, res) => {
    if (req.url === '/') {
      const htmlPath = join(__dirname, 'public', 'index.html');
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family: Arial; padding: 20px; background: #0a0a0a; color: #e5e5e5;">
            <h1>🏆 Team Challenge App</h1>
            <p>WebSocket Server läuft auf Port ${port}</p>
            <p>Frontend: <a href="https://team-challenge-omega.vercel.app" style="color: #3b82f6;">https://team-challenge-omega.vercel.app</a></p>
          </body></html>
        `);
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  const wss = new WebSocketServer({ server });
  console.log(`[ws] listening on :${port}`);

  wss.on('connection', (socket: WebSocket) => {
    let meta: ClientMeta | null = { socket, role: 'admin' }; // Default to admin, will be updated by 'hello'

    socket.on('message', (d: Buffer) => {
      try {
        const msg = JSON.parse(d.toString()) as AnyFromClient;

        if (msg.type === 'hello') {
          const hello = msg as ClientHelloMsg;
          if (hello.role === 'admin') {
            meta = { socket, role: 'admin' };
            // If an event is already created, send its state to the new admin
            if (hello.eventId && rooms.has(hello.eventId)) {
              meta.eventId = hello.eventId; // Bind admin to existing event
              emitState(hello.eventId);
            }
          } else if (hello.role === 'beamer') {
            if (!hello.eventId || !rooms.has(hello.eventId)) {
              socket.send(JSON.stringify({ type: 'error', message: 'Missing eventId' }));
              return;
            }
            meta = { socket, role: 'beamer', eventId: hello.eventId };
            const room = getOrCreateRoom(hello.eventId);
            room.clients.add(meta);
            emitState(hello.eventId);
          } else if (hello.role === 'team') {
            if (!hello.eventId || !rooms.has(hello.eventId) || !hello.teamName) {
              socket.send(JSON.stringify({ type: 'error', message: 'Missing eventId or teamName' }));
              return;
            }
            const room = rooms.get(hello.eventId)!;
            let team = room.state.teams.find(t => t.name === hello.teamName);
            if (!team) {
              team = addTeam(hello.eventId, hello.teamName);
            }
            meta = { socket, role: 'team', eventId: hello.eventId, teamId: team.id };
            room.clients.add(meta);
            emitState(hello.eventId);
          }
        }

        if (!meta) return;

        if (msg.type === 'create_event' && meta.role === 'admin') {
          const id = 'EVT_' + Math.random().toString(36).slice(2, 10).toUpperCase();
          const payload = msg.payload as any;
          const event: EventConfig = {
            id,
            name: payload.name,
            logoUrl: payload.logoUrl,
            countdownSec: payload.countdownSec,
            mode: payload.mode || 'shared',
            levels: (payload.levels || []).map((l: any) => ({ index: l.index, prompt: l.prompt, code: l.code })),
            teamLevels: (payload.teamLevels || []).map((tl: any) => ({
              teamId: tl.teamId,
              teamName: tl.teamName,
              levels: tl.levels.map((l: any) => ({ index: l.index, prompt: l.prompt, code: l.code })),
              finalCode: tl.finalCode
            })),
            finalCode: payload.finalCode,
            finishMediaUrl: payload.finishMediaUrl,
            caseInsensitive: !!payload.caseInsensitive,
            createdAt: Date.now(),
          };
          const state: EventState = {
            event,
            teams: [],
            countdown: { startedAtMs: null, pausedAtMs: null, remainingMs: event.countdownSec * 1000, isRunning: false },
          };
          const room = getOrCreateRoom(event.id);
          room.state = state;
          // Set admin's eventId so they can control countdown
          meta.eventId = event.id;
          const msgId: ServerEventIdMsg = { type: 'event_created', eventId: event.id };
          socket.send(JSON.stringify(msgId));
          emitState(event.id);
          return;
        }

        if (msg.type === 'countdown_control' && meta.eventId) {
          const room = rooms.get(meta.eventId);
          if (!room || !room.state) return;
          const cd = room.state.countdown;

          if (msg.action === 'start') {
            // Start from beginning
            cd.isRunning = true;
            cd.startedAtMs = Date.now();
            cd.pausedAtMs = null;
            cd.remainingMs = room.state.event.countdownSec * 1000;
          } else if (msg.action === 'pause') {
            // Pause: calculate remaining time and stop
            if (cd.isRunning && cd.startedAtMs) {
              const now = Date.now();
              const elapsed = now - cd.startedAtMs;
              const totalDuration = room.state.event.countdownSec * 1000;
              cd.remainingMs = Math.max(0, totalDuration - elapsed);
              cd.isRunning = false;
              cd.pausedAtMs = now;
            }
          } else if (msg.action === 'resume') {
            // Resume: continue from remaining time
            if (!cd.isRunning && cd.remainingMs > 0) {
              cd.isRunning = true;
              // Set startedAtMs so that the remaining time will be correct
              const totalDuration = room.state.event.countdownSec * 1000;
              cd.startedAtMs = Date.now() - (totalDuration - cd.remainingMs);
              cd.pausedAtMs = null;
            }
          } else if (msg.action === 'reset') {
            // Reset to initial state
            cd.isRunning = false;
            cd.startedAtMs = null;
            cd.pausedAtMs = null;
            cd.remainingMs = room.state.event.countdownSec * 1000;
          }
          emitState(meta.eventId);
          return;
        }

        if (msg.type === 'submit_answer' && meta.eventId && meta.teamId) {
          const room = rooms.get(meta.eventId);
          if (!room || !room.state) return;
          const st = room.state;
          const team = st.teams.find(t => t.id === meta!.teamId);
          if (!team) return;
          const ev = st.event;
          const raw = msg.payload.code || '';
          const normalize = (s: string) => st.event.caseInsensitive ? normalizeCode(s).toLowerCase() : normalizeCode(s);

          if (ev.mode === 'shared') {
            // Shared mode logic
            const atFinal = team.currentLevel > ev.levels.length;
            if (!atFinal) {
              const level = ev.levels[team.currentLevel - 1];
              if (level && normalize(raw) === normalize(level.code)) {
                team.solvedCount += 1;
                team.currentLevel += 1;
              }
            } else {
              if (normalize(raw) === normalize(ev.finalCode)) {
                team.finished = true;
                const cd = st.countdown;
                if (cd.isRunning && cd.startedAtMs) {
                  const now = Date.now();
                  const elapsed = now - cd.startedAtMs;
                  const remaining = Math.max(0, cd.remainingMs - elapsed);
                  team.elapsedMs = st.event.countdownSec * 1000 - remaining;
                }
              }
            }
          } else {
            // Individual mode logic
            const teamLevels = ev.teamLevels.find(tl => tl.teamId === team.id);
            if (!teamLevels) return;

            const atFinal = team.currentLevel > teamLevels.levels.length;
            if (!atFinal) {
              const level = teamLevels.levels[team.currentLevel - 1];
              if (level && normalize(raw) === normalize(level.code)) {
                team.solvedCount += 1;
                team.currentLevel += 1;
              }
            } else {
              if (normalize(raw) === normalize(teamLevels.finalCode)) {
                team.finished = true;
                const cd = st.countdown;
                if (cd.isRunning && cd.startedAtMs) {
                  const now = Date.now();
                  const elapsed = now - cd.startedAtMs;
                  const remaining = Math.max(0, cd.remainingMs - elapsed);
                  team.elapsedMs = st.event.countdownSec * 1000 - remaining;
                }
              }
            }
          }
          emitState(meta.eventId);
          return;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    const tick = setInterval(() => {
      // Update countdown for all rooms
      for (const [eventId, room] of rooms.entries()) {
        if (!room.state) continue;
        const cd = room.state.countdown;

        if (cd.isRunning && cd.startedAtMs) {
          const now = Date.now();
          const elapsed = now - cd.startedAtMs;
          const totalDuration = room.state.event.countdownSec * 1000;
          const remain = Math.max(0, totalDuration - elapsed);

          // Update the remaining time
          cd.remainingMs = remain;

          if (remain === 0) {
            cd.isRunning = false;
            cd.startedAtMs = null;
            cd.pausedAtMs = null;
            cd.remainingMs = 0;
          }

          emitState(eventId);
        }
      }
    }, 1000); // Update every second

    socket.on('close', () => {
      clearInterval(tick);
      if (meta?.eventId) {
        const room = rooms.get(meta.eventId);
        if (room) room.clients.delete(meta);
      }
    });
  });

  return { server, wss };
}

function addTeam(eventId: string, teamName: string): TeamState {
  const room = rooms.get(eventId);
  if (!room || !room.state) throw new Error('Event not found');

  const newTeam: TeamState = {
    id: randomUUID(),
    name: teamName,
    currentLevel: 1,
    solvedCount: 0,
    finished: false,
    elapsedMs: 0,
    joinedAt: Date.now(),
  };
  room.state.teams.push(newTeam);
  emitState(eventId);
  return newTeam;
}

// Start server
const port = Number(process.env.PORT || 4001);
const { server } = startServer(port);
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
}); 