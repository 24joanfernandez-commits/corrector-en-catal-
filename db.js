// Base de datos sencilla en un archivo JSON (data/db.json)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const START_CHIPS = 1000;
const BONUS_CHIPS = 500;
const BONUS_COOLDOWN = 3 * 60 * 1000;

let data = { users: {}, sessions: {} };
try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data.users = data.users || {};
  data.sessions = data.sessions || {};
} catch {}

let saveTimer = null;
function writeNow() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 500);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  writeNow();
}

const key = (n) => String(n).toLowerCase();
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

function createSession(name) {
  const token = crypto.randomBytes(24).toString('hex');
  data.sessions[token] = key(name);
  save();
  return token;
}

function register(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return { error: 'El usuario debe tener de 3 a 16 letras, números o _' };
  if (password.length < 4) return { error: 'La contraseña debe tener al menos 4 caracteres' };
  if (data.users[key(username)]) return { error: 'Ese nombre de usuario ya existe' };
  const salt = crypto.randomBytes(16).toString('hex');
  data.users[key(username)] = {
    name: username, salt, hash: hash(password, salt),
    chips: START_CHIPS, created: Date.now(), lastBonus: 0,
  };
  save();
  return { token: createSession(username), name: username };
}

function login(username, password) {
  const u = data.users[key(String(username || '').trim())];
  if (!u) return { error: 'Usuario o contraseña incorrectos' };
  const given = Buffer.from(hash(String(password || ''), u.salt), 'hex');
  if (!crypto.timingSafeEqual(given, Buffer.from(u.hash, 'hex'))) return { error: 'Usuario o contraseña incorrectos' };
  return { token: createSession(u.name), name: u.name };
}

function logout(token) { delete data.sessions[token]; save(); }

function userFromToken(token) {
  const k = data.sessions[token];
  return k && data.users[k] ? data.users[k].name : null;
}

function getChips(name) {
  const u = data.users[key(name)];
  return u ? u.chips : 0;
}

function addChips(name, delta) {
  const u = data.users[key(name)];
  if (!u) return 0;
  u.chips = Math.max(0, Math.floor(u.chips + delta));
  save();
  return u.chips;
}

function claimBonus(name) {
  const u = data.users[key(name)];
  if (!u) return { error: 'Usuario no encontrado' };
  if (u.chips >= 100) return { error: 'El bono solo está disponible si tienes menos de 100 fichas' };
  const wait = BONUS_COOLDOWN - (Date.now() - (u.lastBonus || 0));
  if (wait > 0) return { error: `Espera ${Math.ceil(wait / 1000)} s para el siguiente bono` };
  u.chips += BONUS_CHIPS;
  u.lastBonus = Date.now();
  save();
  return { chips: u.chips };
}

function leaderboard(n = 10) {
  return Object.values(data.users)
    .sort((a, b) => b.chips - a.chips)
    .slice(0, n)
    .map((u) => ({ name: u.name, chips: u.chips }));
}

module.exports = { register, login, logout, userFromToken, getChips, addChips, claimBonus, leaderboard, flush, BONUS_CHIPS };
