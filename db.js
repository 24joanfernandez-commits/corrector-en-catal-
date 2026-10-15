// Base de datos sencilla en un archivo JSON (data/db.json)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const START_CHIPS = 1000;
const BONUS_CHIPS = 500;
const BONUS_COOLDOWN = 3 * 60 * 1000;

// Contraseña de administrador: solo se guarda su hash (nunca el texto).
// En Render se puede cambiar poniendo la variable de entorno ADMIN_PASSWORD.
const ADMIN_SALT = 'vilacasino-admin-v1';
const ADMIN_HASH = '995b511339a799d00b0611384a39d67968b00862ba01ee38c66b09a2b86cdefaefdd544e3f3307ed15ab192d4637efda3f9dcfca4fca3c37d2c0322bb412807e';

let data = { users: {}, sessions: {} };
try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data.users = data.users || {};
  data.sessions = data.sessions || {};
} catch {}

// ---------- Guardado en la nube (Upstash Redis, gratis) ----------
// Si en Render existen estas dos variables, las cuentas se guardan en la nube
// y no se pierden aunque el servidor se duerma o se reinicie.
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = 'vilacasino:db';
const cloud = !!(REDIS_URL && REDIS_TOKEN);

async function redis(cmd) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Carga las cuentas antes de arrancar. Si la nube falla, reintenta: nunca
// arranca vacío para no sobrescribir las cuentas guardadas.
async function init() {
  if (!cloud) { console.log('  Guardado: archivo local data/db.json'); return; }
  for (let i = 1; i <= 5; i++) {
    try {
      const raw = await redis(['GET', REDIS_KEY]);
      if (raw) {
        data = JSON.parse(raw);
        data.users = data.users || {};
        data.sessions = data.sessions || {};
      }
      console.log(`  Guardado: nube (Upstash) · ${Object.keys(data.users).length} cuentas cargadas`);
      return;
    } catch (e) {
      console.log(`  Error cargando de la nube (intento ${i}/5): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw new Error('No se pudo cargar la base de datos de la nube');
}

let cloudTimer = null, cloudDirty = false, cloudBusy = null;
async function pushCloud() {
  if (!cloud) return;
  cloudDirty = false;
  try { await redis(['SET', REDIS_KEY, JSON.stringify(data)]); }
  catch (e) { cloudDirty = true; console.log('  Error guardando en la nube:', e.message); }
}
function scheduleCloud() {
  if (!cloud) return;
  cloudDirty = true;
  if (cloudTimer) return;
  // Como mucho una escritura cada 5 s para no gastar el plan gratuito
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    cloudBusy = pushCloud().finally(() => { cloudBusy = null; if (cloudDirty) scheduleCloud(); });
  }, 5000);
}

let saveTimer = null;
function writeNow() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function save() {
  scheduleCloud();
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 500);
}
async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { writeNow(); } catch {}
  if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
  if (cloudBusy) await cloudBusy;
  if (cloud) await pushCloud();
}

const key = (n) => String(n).toLowerCase();
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

function createSession(name) {
  const token = crypto.randomBytes(24).toString('hex');
  data.sessions[token] = key(name);
  save();
  return token;
}

function checkAdminPassword(pw) {
  pw = String(pw || '');
  if (process.env.ADMIN_PASSWORD) {
    const a = Buffer.from(hash(pw, ADMIN_SALT), 'hex');
    const b = Buffer.from(hash(process.env.ADMIN_PASSWORD, ADMIN_SALT), 'hex');
    return crypto.timingSafeEqual(a, b);
  }
  return crypto.timingSafeEqual(Buffer.from(hash(pw, ADMIN_SALT), 'hex'), Buffer.from(ADMIN_HASH, 'hex'));
}

function bannedUntil(u) {
  return u && u.bannedUntil && u.bannedUntil > Date.now() ? u.bannedUntil : 0;
}

function register(username, password, adminPassword) {
  username = String(username || '').trim();
  password = String(password || '');
  const wantsAdmin = !!adminPassword;
  if (wantsAdmin && !checkAdminPassword(adminPassword)) return { error: 'Contraseña de admin incorrecta', adminFail: true };
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return { error: 'El usuario debe tener de 3 a 16 letras, números o _' };
  if (password.length < 4) return { error: 'La contraseña debe tener al menos 4 caracteres' };
  if (data.users[key(username)]) return { error: 'Ese nombre de usuario ya existe' };
  const salt = crypto.randomBytes(16).toString('hex');
  data.users[key(username)] = {
    name: username, salt, hash: hash(password, salt),
    chips: START_CHIPS, created: Date.now(), lastBonus: 0, isAdmin: wantsAdmin,
  };
  save();
  return { token: createSession(username), name: username };
}

function login(username, password, adminPassword) {
  const u = data.users[key(String(username || '').trim())];
  if (!u) return { error: 'Usuario o contraseña incorrectos' };
  const given = Buffer.from(hash(String(password || ''), u.salt), 'hex');
  if (!crypto.timingSafeEqual(given, Buffer.from(u.hash, 'hex'))) return { error: 'Usuario o contraseña incorrectos' };
  if (adminPassword) {
    if (!checkAdminPassword(adminPassword)) return { error: 'Contraseña de admin incorrecta', adminFail: true };
    u.isAdmin = true;
    save();
  }
  const until = bannedUntil(u);
  if (until && !u.isAdmin) return { error: 'Tu cuenta está baneada', bannedUntil: until };
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

// ---------- Administración ----------
function isAdmin(name) { const u = data.users[key(name)]; return !!(u && u.isAdmin); }
function isBanned(name) { const u = data.users[key(name)]; return u && !u.isAdmin ? bannedUntil(u) : 0; }
function exists(name) { return !!data.users[key(name)]; }

function adminNames() { return Object.values(data.users).filter((u) => u.isAdmin).map((u) => u.name); }

function listUsers() {
  return Object.values(data.users)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ name: u.name, chips: u.chips, isAdmin: !!u.isAdmin, bannedUntil: bannedUntil(u), created: u.created }));
}

function setChips(name, chips) {
  const u = data.users[key(name)];
  if (!u) return false;
  u.chips = Math.max(0, Math.floor(chips));
  save();
  return true;
}

function ban(name, ms) {
  const u = data.users[key(name)];
  if (!u) return 0;
  u.bannedUntil = Date.now() + ms;
  for (const [t, k] of Object.entries(data.sessions)) if (k === key(name)) delete data.sessions[t];
  save();
  return u.bannedUntil;
}

function unban(name) {
  const u = data.users[key(name)];
  if (!u) return false;
  u.bannedUntil = 0;
  save();
  return true;
}

function deleteUser(name) {
  const k = key(name);
  if (!data.users[k]) return false;
  delete data.users[k];
  for (const [t, v] of Object.entries(data.sessions)) if (v === k) delete data.sessions[t];
  save();
  return true;
}

function leaderboard(n = 10) {
  return Object.values(data.users)
    .sort((a, b) => b.chips - a.chips)
    .slice(0, n)
    .map((u) => ({ name: u.name, chips: u.chips }));
}

module.exports = {
  init, register, login, logout, userFromToken, getChips, addChips, claimBonus, leaderboard, flush, BONUS_CHIPS,
  isAdmin, isBanned, exists, adminNames, listUsers, setChips, ban, unban, deleteUser,
};
