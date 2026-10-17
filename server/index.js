'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const engine = require('./engine');
const { MatchRunner } = require('./runner');
const { StageRunner, stageName } = require('./stage');

const PORT = Number(process.env.PORT) || 3000;
const MAX_MEMBERS = 8;
const FRAME_MS = 1000 / 30;

const STATIC = {
  '/engine/': path.join(engine.ROOT, 'engine'),
  '/packs/': path.join(engine.ROOT, 'packs'),
  '/': path.join(engine.ROOT, 'public'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json',
};

// ------------------------------------------------------------ static files
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const prefix = Object.keys(STATIC).find(k => p.startsWith(k));
  const base = STATIC[prefix];
  const file = path.join(base, path.normalize(p.slice(prefix.length)));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const cache = prefix === '/' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
});

// ------------------------------------------------------------ rooms
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 512 } });
const rooms = new Map();
let nextId = 1;
let E = null; // loaded engine
let catalog = null;

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}
function humans(room) { return [...room.members.values()].filter(m => !m.bot); }
function broadcast(room, msg) {
  const s = JSON.stringify(msg);
  for (const m of humans(room)) send(m.ws, s);
}
function newRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); } while (rooms.has(code));
  return code;
}

function buildCatalog() {
  const d = E.pack.data;
  return {
    characters: d.object.filter(o => o.type === 'character' && !o.hidden).map(o => ({ id: o.id, name: o.name, pic: o.pic })),
    backgrounds: d.background.filter(b => !/template/i.test(b.name)).map(b => ({ id: b.id, name: b.name })),
    AI: d.AI.map(a => ({ id: a.id, name: a.name })),
    stages: E.stages.map((st, i) => ({ index: i, name: stageName(st.id) })),
  };
}

function lobbyMsg(room) {
  return {
    t: 'lobby', room: room.code, host: room.host, state: room.runner ? 'playing' : 'lobby',
    settings: room.settings,
    players: [...room.members.values()].map(m => ({ id: m.id, name: m.name, char: m.char, team: m.team, bot: m.bot, ai: m.ai })),
  };
}

function freeChar(room) {
  const used = new Set([...room.members.values()].map(m => m.char));
  const list = catalog.characters.filter(c => c.id !== 30); // skip Bandit by default
  const c = list.find(c => !used.has(c.id)) || list[(Math.random() * list.length) | 0];
  return c.id;
}

async function startGame(room) {
  if (room.starting || room.runner) return;
  room.starting = true;
  const s = room.settings;
  let bg = s.background;
  if (bg === -1) bg = catalog.backgrounds[(Math.random() * catalog.backgrounds.length) | 0].id;
  const players = [...room.members.values()].map(m => ({
    id: m.id, name: m.name, char: m.char === -1 ? catalog.characters[(Math.random() * catalog.characters.length) | 0].id : m.char,
    team: m.team, bot: m.bot, ai: m.ai,
  }));
  const hooks = {
    onSummary: summary => {
      broadcast(room, { t: 'summary', ...summary });
      clearTimeout(room.endTimer);
      room.endTimer = setTimeout(() => endGame(room), 12000);
    },
  };
  const runner = s.mode === 'stage' && E.stages.length
    ? new StageRunner(E, { players, stageIndex: s.stage }, hooks)
    : new MatchRunner(E, { players, background: bg }, hooks);
  try {
    await runner.start();
  } catch (e) {
    console.error(e);
    room.starting = false;
    broadcast(room, { t: 'err', msg: '遊戲啟動失敗：' + e.message });
    return;
  }
  room.starting = false;
  room.runner = runner;
  broadcast(room, { t: 'start', me: null });
  broadcast(room, lobbyMsg(room));
}

function endGame(room) {
  clearTimeout(room.endTimer);
  room.endTimer = null;
  if (room.runner) room.runner.destroy();
  room.runner = null;
  broadcast(room, { t: 'stop' });
  broadcast(room, lobbyMsg(room));
}

function stepRoom(room) {
  if (!room.runner) return;
  let frame;
  try {
    frame = room.runner.step();
  } catch (e) {
    console.error('match error', e);
    broadcast(room, { t: 'err', msg: '遊戲發生錯誤，已回到大廳' });
    endGame(room);
    return;
  }
  for (const msg of Array.isArray(frame) ? frame : [frame]) broadcast(room, msg);
}

wss.on('connection', ws => {
  const id = nextId++;
  let room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'k') {
      if (room && room.runner && engine.KEYS.includes(msg.k)) room.runner.input(id, msg.k, !!msg.d);
      return;
    }
    if (msg.t === 'ping') { send(ws, { t: 'pong', ts: msg.ts }); return; }

    if (msg.t === 'join') {
      if (room) return;
      const name = String(msg.name || '').trim().slice(0, 12) || '玩家' + id;
      let code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (!code) code = newRoomCode();
      let r = rooms.get(code);
      if (!r) {
        r = { code, host: id, members: new Map(), runner: null, settings: { mode: 'vs', background: -1, stage: 0 } };
        rooms.set(code, r);
      }
      if (r.members.size >= MAX_MEMBERS) { send(ws, { t: 'err', msg: `房間已滿（最多 ${MAX_MEMBERS} 個角色）` }); return; }
      if (!humans(r).length) r.host = id;
      room = r;
      r.members.set(id, { id, name, char: freeChar(r), team: 0, bot: false, ws });
      send(ws, { t: 'welcome', id, room: code, catalog });
      broadcast(r, lobbyMsg(r));
      if (r.runner) {
        const full = r.runner.full();
        if (full) { send(ws, { t: 'start', spectator: true }); send(ws, full); }
      }
      return;
    }

    if (!room) return;
    const isHost = room.host === id;
    const lobbyOpen = !room.runner && !room.starting;
    const charOk = c => c === -1 || catalog.characters.some(x => x.id === c);

    switch (msg.t) {
      case 'pick': {
        let target = room.members.get(id);
        if (msg.id !== undefined && msg.id !== id) {
          const m = room.members.get(msg.id);
          target = isHost && m && m.bot ? m : null;
        }
        if (!target || !lobbyOpen) break;
        if (Number.isInteger(msg.char) && charOk(msg.char)) target.char = msg.char;
        if (Number.isInteger(msg.team) && msg.team >= 0 && msg.team <= 4) target.team = msg.team;
        if (target.bot && Number.isInteger(msg.ai) && catalog.AI.some(a => a.id === msg.ai)) target.ai = msg.ai;
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'settings': {
        if (!isHost || !lobbyOpen) break;
        if (Number.isInteger(msg.background) && (msg.background === -1 || catalog.backgrounds.some(b => b.id === msg.background))) room.settings.background = msg.background;
        if (msg.mode === 'vs' || msg.mode === 'stage') room.settings.mode = msg.mode;
        if (Number.isInteger(msg.stage) && msg.stage >= 0 && msg.stage < E.stages.length) room.settings.stage = msg.stage;
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'bot': {
        if (!isHost || !lobbyOpen || room.members.size >= MAX_MEMBERS) break;
        const bid = nextId++;
        const n = [...room.members.values()].filter(m => m.bot).length + 1;
        room.members.set(bid, { id: bid, name: '電腦' + n, char: freeChar(room), team: 0, bot: true, ai: 1, ws: null });
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'kick': {
        const m = room.members.get(msg.id);
        if (!isHost || !lobbyOpen || !m || !m.bot) break;
        room.members.delete(msg.id);
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'start':
        if (isHost && lobbyOpen) startGame(room);
        break;
      case 'stop':
        if (isHost && room.runner) endGame(room);
        break;
      case 'debug': // test helper, only with LF2_DEBUG=1: defeat every enemy on screen
        if (process.env.LF2_DEBUG === '1' && room.runner && room.runner.debugClear) room.runner.debugClear();
        break;
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.members.delete(id);
    if (room.runner) room.runner.dropPlayer(id);
    const hs = humans(room);
    if (!hs.length) {
      if (room.runner) room.runner.destroy();
      clearTimeout(room.endTimer);
      rooms.delete(room.code);
      return;
    }
    if (room.host === id) room.host = hs[0].id;
    broadcast(room, lobbyMsg(room));
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// ------------------------------------------------------------ fixed-rate loop
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  if (acc > 250) acc = FRAME_MS;
  while (acc >= FRAME_MS) {
    acc -= FRAME_MS;
    for (const r of rooms.values()) stepRoom(r);
  }
}, 4);

engine.load().then(e => {
  E = e;
  catalog = buildCatalog();
  server.listen(PORT, () => console.log(`LF2 連線版伺服器已啟動：http://localhost:${PORT}`));
}).catch(e => { console.error('引擎載入失敗', e); process.exit(1); });
