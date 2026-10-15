// Royal Casino — servidor para jugar con amigos en la misma red
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

const db = require('./db');
const roulette = require('./games/roulette');
const football = require('./games/football');
const { PokerGame } = require('./games/poker');
const { BlackjackGame } = require('./games/blackjack');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// Límite de intentos fallidos de contraseña de admin (5 cada 10 min por IP)
const adminFails = new Map();
function adminBlocked(ip) {
  const f = adminFails.get(ip);
  return f && f.count >= 5 && Date.now() - f.first < 10 * 60 * 1000;
}
function noteAdminFail(ip) {
  const f = adminFails.get(ip);
  if (!f || Date.now() - f.first > 10 * 60 * 1000) adminFails.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}
function authRoute(fn) {
  return (req, res) => {
    const adminPw = String(req.body.adminPassword || '');
    if (adminPw && adminBlocked(req.ip)) return res.status(429).json({ error: 'Demasiados intentos de admin. Espera 10 minutos.' });
    const r = fn(req.body.username, req.body.password, adminPw);
    if (r.adminFail) noteAdminFail(req.ip);
    res.status(r.error ? 400 : 200).json(r);
  };
}
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', authRoute(db.register));
app.post('/api/login', authRoute(db.login));
app.post('/api/logout', (req, res) => {
  db.logout(String(req.body.token || ''));
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server);

// ---------------- Estado ----------------
const rooms = new Map();      // id -> sala
const userRoom = new Map();   // usuario -> id de sala
const connections = new Map(); // usuario -> nº de pestañas abiertas
const leaveTimers = new Map();
const globalChat = [];
const lastChat = new Map();
let nextRoomId = 1;

const toUser = (name) => io.to('user:' + name);
const sendMe = (name) => toUser(name).emit('me', { name, chips: db.getChips(name), admin: db.isAdmin(name) });

let lobbyTimer = null;
function broadcastLobby() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    io.to('global').emit('lobby', lobbyData());
  }, 250);
}
function lobbyData() {
  return {
    rooms: [...rooms.values()].map((r) => ({
      id: r.id, name: r.name, type: r.type, host: r.host,
      players: r.game.playerCount, max: r.game.max, min: r.game.min, status: r.game.status,
    })),
    online: connections.size,
    leaderboard: db.leaderboard(10),
    admins: db.adminNames(),
  };
}

function sendRoom(room) {
  for (const s of room.game.seats) {
    if (s.left) continue;
    toUser(s.name).emit('room:state', {
      id: room.id, name: room.name, type: room.type, host: room.host, max: room.game.max,
      game: room.game.stateFor(s.name),
    });
    sendMe(s.name);
  }
  broadcastLobby();
}

function createRoom(host, { game, name, max }) {
  const type = game === 'blackjack' ? 'blackjack' : 'poker';
  const limits = type === 'poker' ? [3, 10] : [1, 7];
  max = Math.max(limits[0], Math.min(limits[1], Math.floor(Number(max)) || limits[1]));
  const room = {
    id: String(nextRoomId++),
    name: String(name || '').trim().slice(0, 30) || `Mesa de ${host}`,
    type, host, chat: [], pending: false,
  };
  const ctx = {
    getChips: (n) => db.getChips(n),
    addChips: (n, d) => db.addChips(n, d),
    event: (n, kind, data) => toUser(n).emit('game:event', { kind, game: type, ...data }),
    update: () => {
      if (room.pending) return;
      room.pending = true;
      setImmediate(() => { room.pending = false; if (rooms.has(room.id)) sendRoom(room); });
    },
  };
  room.game = type === 'poker' ? new PokerGame(ctx, { max }) : new BlackjackGame(ctx, { max });
  rooms.set(room.id, room);
  return room;
}

function roomChat(room, msg) {
  room.chat.push(msg);
  if (room.chat.length > 60) room.chat.shift();
  io.to('room:' + room.id).emit('chat:room', msg);
}

function joinRoom(name, id) {
  const room = rooms.get(String(id));
  if (!room) return 'Esa mesa ya no existe';
  const current = userRoom.get(name);
  if (current && current !== room.id) return 'Ya estás en otra mesa';
  if (!current) {
    const err = room.game.addPlayer(name);
    if (err) return err;
    userRoom.set(name, room.id);
    roomChat(room, { system: true, text: `${name} se ha sentado en la mesa`, ts: Date.now() });
  }
  io.in('user:' + name).socketsJoin('room:' + room.id);
  toUser(name).emit('chat:roomHistory', room.chat);
  room.game.ctx.update();
  return null;
}

function leaveRoom(name) {
  const id = userRoom.get(name);
  if (!id) return;
  userRoom.delete(name);
  io.in('user:' + name).socketsLeave('room:' + id);
  toUser(name).emit('room:left');
  sendMe(name);
  const room = rooms.get(id);
  if (!room) return;
  room.game.removePlayer(name);
  roomChat(room, { system: true, text: `${name} ha salido de la mesa`, ts: Date.now() });
  if (room.game.playerCount === 0) {
    room.game.destroy();
    rooms.delete(id);
  } else if (room.host === name) {
    room.host = room.game.seats.find((s) => !s.left).name;
    roomChat(room, { system: true, text: `${room.host} es ahora el anfitrión`, ts: Date.now() });
    room.game.ctx.update();
  }
  broadcastLobby();
}

// Echa a un usuario: lo levanta de la mesa y cierra sus conexiones
function kick(name, reason, until) {
  leaveRoom(name);
  clearTimeout(leaveTimers.get(name));
  leaveTimers.delete(name);
  toUser(name).emit('kicked', { reason, until });
  io.in('user:' + name).disconnectSockets(true);
  connections.delete(name);
  broadcastLobby();
}

// ---------------- Sockets ----------------
io.use((socket, next) => {
  const name = db.userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!name) return next(new Error('auth'));
  if (db.isBanned(name)) return next(new Error('banned'));
  socket.data.name = name;
  next();
});

io.on('connection', (socket) => {
  const name = socket.data.name;
  socket.join('user:' + name);
  socket.join('global');
  connections.set(name, (connections.get(name) || 0) + 1);
  clearTimeout(leaveTimers.get(name));
  leaveTimers.delete(name);

  socket.emit('me', { name, chips: db.getChips(name), admin: db.isAdmin(name) });
  socket.emit('chat:history', globalChat);
  socket.emit('lobby', lobbyData());
  broadcastLobby();
  if (userRoom.has(name)) joinRoom(name, userRoom.get(name));

  const reply = (cb) => (typeof cb === 'function' ? cb : () => {});

  socket.on('lobby:refresh', () => socket.emit('lobby', lobbyData()));

  socket.on('room:create', (data, cb) => {
    cb = reply(cb);
    if (userRoom.has(name)) return cb({ error: 'Ya estás en una mesa' });
    const room = createRoom(name, data || {});
    const err = joinRoom(name, room.id);
    if (err) { rooms.delete(room.id); return cb({ error: err }); }
    cb({ ok: true, id: room.id });
  });

  socket.on('room:join', (data, cb) => {
    cb = reply(cb);
    const err = joinRoom(name, data && data.id);
    cb(err ? { error: err } : { ok: true });
  });

  socket.on('room:leave', (cb) => { leaveRoom(name); reply(cb)({ ok: true }); });

  socket.on('room:start', (cb) => {
    cb = reply(cb);
    const room = rooms.get(userRoom.get(name));
    if (!room || room.type !== 'poker') return cb({ error: 'No estás en una mesa de póker' });
    if (room.host !== name) return cb({ error: 'Solo el anfitrión puede empezar' });
    const err = room.game.start();
    if (!err) roomChat(room, { system: true, text: '¡Empieza la partida! Ciegas 10/20', ts: Date.now() });
    room.game.ctx.update();
    cb(err ? { error: err } : { ok: true });
  });

  socket.on('game:action', (data, cb) => {
    cb = reply(cb);
    const room = rooms.get(userRoom.get(name));
    if (!room || !data) return cb({ error: 'No estás en ninguna mesa' });
    const err = room.game.handle(name, String(data.action), data);
    room.game.ctx.update();
    cb(err ? { error: err } : { ok: true });
  });

  socket.on('chat:send', (data) => {
    const text = String((data && data.text) || '').trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    if (now - (lastChat.get(name) || 0) < 400) return;
    lastChat.set(name, now);
    const msg = { name, text, ts: now, admin: db.isAdmin(name) };
    if (data.scope === 'room') {
      const room = rooms.get(userRoom.get(name));
      if (room) roomChat(room, msg);
    } else {
      globalChat.push(msg);
      if (globalChat.length > 80) globalChat.shift();
      io.to('global').emit('chat:global', msg);
    }
  });

  socket.on('roulette:spin', (data, cb) => {
    cb = reply(cb);
    if (userRoom.has(name)) return cb({ error: 'Sal de tu mesa para jugar a la ruleta' });
    const r = roulette.play(data && data.bets, db.getChips(name));
    if (r.error) return cb(r);
    const chips = db.addChips(name, r.payout - r.total);
    cb({ ...r, chips });
    setTimeout(() => { sendMe(name); broadcastLobby(); }, 8000);
  });

  // ---------- Fútbol ----------
  socket.on('football:teams', (cb) => reply(cb)({ teams: football.TEAMS, fixtures: football.fixtures(6) }));
  socket.on('football:fixtures', (cb) => reply(cb)({ fixtures: football.fixtures(6) }));
  socket.on('football:info', (data, cb) => {
    const r = football.info(String(data && data.home), String(data && data.away));
    reply(cb)(r || { error: 'Elige dos equipos distintos' });
  });
  let footballBusyUntil = 0;
  socket.on('football:bet', (data, cb) => {
    cb = reply(cb);
    if (userRoom.has(name)) return cb({ error: 'Sal de tu mesa para apostar en el fútbol' });
    if (Date.now() < footballBusyUntil) return cb({ error: 'Espera a que termine el partido' });
    const r = football.play(data || {}, db.getChips(name));
    if (r.error) return cb(r);
    const chips = db.addChips(name, r.payout - r.amount);
    footballBusyUntil = Date.now() + 20000;
    cb({ ...r, chips });
    setTimeout(() => { sendMe(name); broadcastLobby(); }, 32000);
  });

  // ---------- Ranking completo ----------
  socket.on('leaderboard:full', (cb) => reply(cb)({ top: db.leaderboard(50), admins: db.adminNames(), total: db.listUsers().length }));

  socket.on('bonus:claim', (cb) => {
    cb = reply(cb);
    if (userRoom.has(name)) return cb({ error: 'Sal de la mesa para pedir el bono' });
    const r = db.claimBonus(name);
    if (!r.error) { sendMe(name); broadcastLobby(); }
    cb(r);
  });

  // ---------- Panel de administración ----------
  const admin = (cb) => {
    if (db.isAdmin(name)) return true;
    reply(cb)({ error: 'No tienes permisos de administrador' });
    return false;
  };
  const target = (data) => String((data && data.user) || '');

  socket.on('admin:users', (cb) => {
    if (!admin(cb)) return;
    reply(cb)({
      users: db.listUsers().map((u) => ({ ...u, online: connections.has(u.name), inRoom: userRoom.has(u.name) })),
    });
  });

  socket.on('admin:setChips', (data, cb) => {
    if (!admin(cb)) return;
    cb = reply(cb);
    const user = target(data);
    const chips = Math.floor(Number(data && data.chips));
    if (!db.exists(user)) return cb({ error: 'Ese usuario no existe' });
    if (!Number.isFinite(chips) || chips < 0 || chips > 1e12) return cb({ error: 'Cantidad no válida' });
    db.setChips(user, chips);
    sendMe(user);
    const room = rooms.get(userRoom.get(user));
    if (room) room.game.ctx.update();
    broadcastLobby();
    cb({ ok: true });
  });

  socket.on('admin:ban', (data, cb) => {
    if (!admin(cb)) return;
    cb = reply(cb);
    const user = target(data);
    const minutes = Math.floor(Number(data && data.minutes));
    if (!db.exists(user)) return cb({ error: 'Ese usuario no existe' });
    if (user.toLowerCase() === name.toLowerCase()) return cb({ error: 'No puedes banearte a ti mismo' });
    if (db.isAdmin(user)) return cb({ error: 'No puedes banear a otro admin' });
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) return cb({ error: 'Duración no válida' });
    const until = db.ban(user, minutes * 60000);
    kick(user, 'banned', until);
    cb({ ok: true, until });
  });

  socket.on('admin:unban', (data, cb) => {
    if (!admin(cb)) return;
    cb = reply(cb);
    if (!db.unban(target(data))) return cb({ error: 'Ese usuario no existe' });
    cb({ ok: true });
  });

  socket.on('admin:delete', (data, cb) => {
    if (!admin(cb)) return;
    cb = reply(cb);
    const user = target(data);
    if (!db.exists(user)) return cb({ error: 'Ese usuario no existe' });
    if (user.toLowerCase() === name.toLowerCase()) return cb({ error: 'No puedes eliminar tu propia cuenta' });
    if (db.isAdmin(user)) return cb({ error: 'No puedes eliminar a otro admin' });
    kick(user, 'deleted');
    db.deleteUser(user);
    broadcastLobby();
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const n = (connections.get(name) || 1) - 1;
    if (n > 0) { connections.set(name, n); return; }
    connections.delete(name);
    broadcastLobby();
    // Si no vuelve en 60 s, se le levanta de la mesa
    leaveTimers.set(name, setTimeout(() => { leaveTimers.delete(name); leaveRoom(name); }, 60000));
  });
});

db.init().then(() => server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  console.log('\n  ♠ ROYAL CASINO está funcionando\n');
  console.log(`  En este ordenador:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Para tus amigos:     http://${ip}:${PORT}`);
  console.log('\n  (Pulsa Ctrl+C para cerrar el servidor)\n');
})).catch((e) => { console.error(e.message); process.exit(1); });

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  db.flush().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
