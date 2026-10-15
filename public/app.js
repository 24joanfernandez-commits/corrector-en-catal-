// ================= Núcleo de la app =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('es-ES');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const App = {
  socket: null,
  me: { name: '', chips: 0 },
  room: null,
  view: 'auth',
  lobby: { rooms: [], leaderboard: [], online: 0 },
  filter: 'all',
};

function colorFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 75% 65%)`;
}
// Nombre con estilo de admin (morado + etiqueta) si corresponde
const isAdminName = (name) => (App.lobby.admins || []).includes(name);
function nameHTML(name, extra = '') {
  return isAdminName(name)
    ? `<span class="admin-name">${esc(name)}</span><span class="admin-badge">ADMIN</span>${extra}`
    : `${esc(name)}${extra}`;
}
function avatarHTML(name, cls = '') {
  if (isAdminName(name)) cls += ' admin-av';
  return `<span class="avatar ${cls}" style="--av:${colorFor(name)}">${esc(String(name)[0] || '?').toUpperCase()}</span>`;
}

// ---------- Vistas ----------
function show(view) {
  App.view = view;
  for (const v of ['auth', 'lobby', 'room', 'roulette', 'admin']) $('#view-' + v).classList.toggle('hidden', v !== view);
  $('#topbar').classList.toggle('hidden', view === 'auth');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
  if (view === 'roulette' && typeof Roulette !== 'undefined') Roulette.onShow();
  if (view === 'admin') Admin.load();
}

function toast(msg, kind = 'error') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3300);
}

// ---------- Pantalla de resultado (VICTORY / DEFEAT) ----------
let overlayTimer = null;
function showResult(kind, amount, label) {
  const ov = $('#overlay');
  const title = label || (kind === 'victory' ? 'VICTORY' : kind === 'defeat' ? 'DEFEAT' : 'EMPATE');
  const sub = kind === 'push' ? 'Recuperas tu apuesta' : (amount > 0 ? '+' : '') + fmt(amount) + ' fichas';
  ov.className = 'result-overlay';
  ov.innerHTML = `<div class="ov-band"></div><div class="ov-text">${esc(title)}</div><div class="ov-sub">${esc(sub)}</div>`;
  void ov.offsetWidth;
  ov.classList.add('show', kind);
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => ov.classList.remove('show'), 2700);
  Sound.play(kind);
}

// ---------- Sonidos sintetizados (sin archivos) ----------
const Sound = {
  ctx: null,
  tone(freq, dur, type = 'sine', vol = 0.08, when = 0) {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    } catch {}
  },
  play(kind) {
    if (kind === 'victory') [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.09, i * 0.09));
    else if (kind === 'defeat') [300, 240, 180].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.05, i * 0.16));
    else if (kind === 'card') this.tone(1800, 0.04, 'square', 0.02);
    else if (kind === 'chip') { this.tone(2400, 0.05, 'triangle', 0.05); this.tone(3100, 0.04, 'triangle', 0.03, 0.03); }
    else if (kind === 'turn') this.tone(880, 0.15, 'sine', 0.06);
    else if (kind === 'tick') this.tone(1200 + Math.random() * 300, 0.02, 'square', 0.015);
    else this.tone(440, 0.2, 'sine', 0.05);
  },
};

// ---------- Cartas con animación de reparto ----------
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const Cards = {
  seen: new Map(), // clave -> { v, t0 }
  html(c, key, extra = '') {
    if (!c || c === 'XX') return `<div class="card back ${extra}" data-k="${key}" data-v="XX"></div>`;
    const r = c[0] === 'T' ? '10' : c[0];
    const s = SUIT[c[1]];
    const red = c[1] === 'h' || c[1] === 'd' ? ' red' : '';
    return `<div class="card${red} ${extra}" data-k="${key}" data-v="${c}"><span class="cr">${r}<i>${s}</i></span><span class="cs">${s}</span><span class="cr2">${r}<i>${s}</i></span></div>`;
  },
  animate(container, deckEl) {
    const now = performance.now();
    const deck = deckEl ? deckEl.getBoundingClientRect() : null;
    let delay = 0, dealt = 0;
    for (const el of container.querySelectorAll('.card[data-k]')) {
      const k = el.dataset.k, v = el.dataset.v;
      const prev = this.seen.get(k);
      if (!prev) {
        const r = el.getBoundingClientRect();
        const fx = deck ? deck.left + deck.width / 2 - (r.left + r.width / 2) : 0;
        const fy = deck ? deck.top + deck.height / 2 - (r.top + r.height / 2) : -200;
        const t0 = now + delay;
        this.seen.set(k, { v, t0, fx, fy });
        this.applyDeal(el, t0 - now, fx, fy);
        setTimeout(() => Sound.play('card'), delay);
        delay += 120; dealt++;
      } else {
        if (prev.v === 'XX' && v !== 'XX') el.classList.add('flip');
        else if (now < prev.t0 + 500) this.applyDeal(el, prev.t0 - now, prev.fx, prev.fy);
        prev.v = v;
      }
    }
    return dealt;
  },
  applyDeal(el, delayMs, fx, fy) {
    el.style.setProperty('--fx', fx + 'px');
    el.style.setProperty('--fy', fy + 'px');
    el.style.setProperty('--d', delayMs + 'ms');
    el.classList.add('deal');
  },
  reset() { this.seen.clear(); },
};

// ---------- Temporizadores visuales ----------
setInterval(() => {
  const now = Date.now();
  for (const el of $$('[data-deadline]')) {
    const dl = +el.dataset.deadline, total = +el.dataset.total || 1;
    const left = Math.max(0, dl - now);
    if (el.classList.contains('timer-bar')) {
      el.style.setProperty('--p', (left / total).toFixed(3));
      el.classList.toggle('low', left < 6000);
    } else el.textContent = Math.ceil(left / 1000);
  }
}, 100);

// ---------- Login / registro ----------
let authMode = 'login';
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  authMode = t.dataset.tab;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#pass2-wrap').classList.toggle('hidden', authMode === 'login');
  $('#auth-submit').textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('#auth-hint').innerHTML = authMode === 'login'
    ? '¿No tienes cuenta? Crea una y recibe <b>1.000 fichas</b> gratis.'
    : 'Al crear tu cuenta recibes <b>1.000 fichas</b> de regalo.';
  $('#auth-pass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}));

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#auth-user').value.trim();
  const password = $('#auth-pass').value;
  const adminPassword = $('#auth-admin').value;
  if (authMode === 'register' && password !== $('#auth-pass2').value) {
    $('#auth-error').textContent = 'Las contraseñas no coinciden';
    return;
  }
  $('#auth-submit').disabled = true;
  try {
    const res = await fetch('/api/' + authMode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, adminPassword }),
    });
    const data = await res.json();
    if (data.error) {
      $('#auth-error').textContent = data.error + (data.bannedUntil ? ' hasta el ' + fmtDate(data.bannedUntil) : '');
      return;
    }
    $('#auth-admin').value = '';
    if (adminPassword) setTimeout(() => toast('Has entrado como administrador', 'ok'), 400);
    store.set('rc_token', data.token);
    if (authMode === 'register') setTimeout(() => toast('¡Bienvenido! Tienes 1.000 fichas para empezar', 'ok'), 400);
    connect(data.token);
  } catch {
    $('#auth-error').textContent = 'No se puede conectar con el servidor';
  } finally {
    $('#auth-submit').disabled = false;
  }
});

$('#logout-btn').addEventListener('click', () => {
  const token = store.get('rc_token');
  fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => {});
  store.del('rc_token');
  if (App.socket) App.socket.disconnect();
  App.socket = null;
  App.room = null;
  show('auth');
});

// ---------- Conexión ----------
function connect(token) {
  if (App.socket) App.socket.disconnect();
  const socket = io({ auth: { token } });
  App.socket = socket;

  socket.on('connect_error', (err) => {
    if (err.message === 'auth' || err.message === 'banned') {
      if (err.message === 'banned') $('#auth-error').textContent = 'Tu cuenta está baneada temporalmente';
      store.del('rc_token');
      socket.disconnect();
      show('auth');
    }
  });
  socket.on('connect', () => { if (App.view === 'auth') show('lobby'); });
  socket.on('disconnect', (reason) => { if (reason !== 'io server disconnect') toast('Conexión perdida, reconectando…'); });
  socket.on('kicked', (k) => {
    store.del('rc_token');
    App.room = null;
    show('auth');
    $('#auth-error').textContent = k.reason === 'banned'
      ? 'Un admin te ha baneado hasta el ' + fmtDate(k.until)
      : 'Un admin ha eliminado tu cuenta';
  });

  socket.on('me', (me) => {
    const changed = me.chips !== App.me.chips;
    App.me = me;
    $$('.admin-nav').forEach((b) => b.classList.toggle('hidden', !me.admin));
    if (!me.admin && App.view === 'admin') show('lobby');
    paintMe();
    if (!(typeof Roulette !== 'undefined' && Roulette.spinning)) setChips(me.chips, changed);
  });

  socket.on('lobby', (data) => {
    const before = JSON.stringify(App.lobby.admins || []);
    App.lobby = data;
    renderLobby();
    paintMe();
    if (before !== JSON.stringify(data.admins || []) && App.room) renderRoom();
  });
  socket.on('chat:history', (msgs) => { $('#global-chat').innerHTML = ''; msgs.forEach((m) => addChat('#global-chat', m)); });
  socket.on('chat:global', (m) => addChat('#global-chat', m));
  socket.on('chat:roomHistory', (msgs) => { $('#room-chat').innerHTML = ''; msgs.forEach((m) => addChat('#room-chat', m)); });
  socket.on('chat:room', (m) => addChat('#room-chat', m));

  socket.on('room:state', (st) => {
    const isNew = !App.room || App.room.id !== st.id;
    App.room = st;
    if (isNew) { Cards.reset(); $('#action-bar').innerHTML = ''; $('#action-bar').dataset.key = ''; }
    if (App.view !== 'room') show('room');
    renderRoom();
  });
  socket.on('room:left', () => {
    App.room = null;
    $('#table-wrap').innerHTML = '';
    $('#action-bar').innerHTML = '';
    if (App.view === 'room') show('lobby');
  });
  socket.on('game:event', (ev) => {
    setTimeout(() => showResult(ev.kind, ev.amount, ev.label), ev.delay || 0);
  });
}

function paintMe() {
  const me = App.me;
  if (!me.name) return;
  const admin = me.admin || isAdminName(me.name);
  $('#my-name').innerHTML = admin ? `<span class="admin-name">${esc(me.name)}</span><span class="admin-badge">ADMIN</span>` : esc(me.name);
  $('#my-avatar').outerHTML = `<span class="avatar${admin ? ' admin-av' : ''}" id="my-avatar" style="--av:${colorFor(me.name)}">${esc(me.name[0].toUpperCase())}</span>`;
}

function setChips(n, animate) {
  const el = $('#my-chips');
  el.textContent = fmt(n);
  if (animate) { el.parentElement.classList.remove('bump'); void el.offsetWidth; el.parentElement.classList.add('bump'); }
  $('#bonus-btn').classList.toggle('hidden', n >= 100);
}

$('#bonus-btn').addEventListener('click', () => {
  App.socket.emit('bonus:claim', (r) => {
    if (r.error) toast(r.error);
    else { toast('¡Has recibido 500 fichas!', 'ok'); Sound.play('chip'); }
  });
});

// ---------- Navegación ----------
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
  const to = b.dataset.nav;
  if (App.room && to !== 'room') {
    if (to === 'lobby') { show('lobby'); return; }
    toast('Sal de la mesa para jugar a la ruleta');
    return;
  }
  show(to);
}));
$('#logo-home').addEventListener('click', () => show(App.room ? 'room' : 'lobby'));

// ---------- Lobby ----------
function renderLobby() {
  const { rooms, leaderboard, online } = App.lobby;
  $('#online-count').textContent = online;
  const list = rooms.filter((r) => App.filter === 'all' || r.type === App.filter);
  $('#room-list').innerHTML = list.length ? list.map((r) => {
    const full = r.players >= r.max;
    const mine = App.room && App.room.id === r.id;
    return `<div class="room-row">
      <div class="rr-icon ${r.type}">${r.type === 'poker' ? '♠' : '21'}</div>
      <div class="rr-info"><b>${esc(r.name)}</b><span>${r.type === 'poker' ? "Texas Hold'em" : 'Blackjack'} · Anfitrión: ${nameHTML(r.host)}</span></div>
      <div class="rr-players"><div class="bar"><i style="width:${(r.players / r.max) * 100}%"></i></div>${r.players}/${r.max}</div>
      <div class="rr-status ${r.status === 'Jugando' ? 'live' : ''}">${r.status}</div>
      <button class="btn ${mine ? 'green' : 'gold'} small" data-join="${r.id}" ${full && !mine ? 'disabled' : ''}>${mine ? 'Volver' : full ? 'Llena' : 'Unirse'}</button>
    </div>`;
  }).join('') : `<div class="empty">No hay mesas abiertas. ¡Crea una y avisa a tus amigos!</div>`;

  $('#leaderboard').innerHTML = leaderboard.map((u, i) => `<li class="${u.name === App.me.name ? 'me' : ''}">
    <span class="rank r${i + 1}">${i + 1}</span>${avatarHTML(u.name, 'sm')}<span class="lb-name">${nameHTML(u.name)}</span><span class="lb-chips">${fmt(u.chips)}</span></li>`).join('');
}

$('#room-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-join]');
  if (!b) return;
  if (App.room && App.room.id === b.dataset.join) { show('room'); return; }
  App.socket.emit('room:join', { id: b.dataset.join }, (r) => r.error && toast(r.error));
});

$$('.chip-filter').forEach((b) => b.addEventListener('click', () => {
  App.filter = b.dataset.filter;
  $$('.chip-filter').forEach((x) => x.classList.toggle('active', x === b));
  renderLobby();
}));

// ---------- Crear mesa ----------
let createGame = 'poker';
function setCreateGame(g) {
  createGame = g;
  $$('#create-game button').forEach((b) => b.classList.toggle('active', b.dataset.game === g));
  const r = $('#create-max');
  r.min = g === 'poker' ? 3 : 1;
  r.max = g === 'poker' ? 10 : 7;
  r.value = r.max;
  $('#create-max-val').textContent = r.value;
}
$$('[data-create]').forEach((b) => b.addEventListener('click', () => {
  if (App.room) { toast('Ya estás en una mesa'); return; }
  setCreateGame(b.dataset.create);
  $('#create-name').value = '';
  $('#create-name').placeholder = `Mesa de ${App.me.name}`;
  $('#modal').classList.remove('hidden');
  setTimeout(() => $('#create-name').focus(), 50);
}));
$$('#create-game button').forEach((b) => b.addEventListener('click', () => setCreateGame(b.dataset.game)));
$('#create-max').addEventListener('input', (e) => { $('#create-max-val').textContent = e.target.value; });
$('#create-cancel').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
$('#create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  App.socket.emit('room:create', { game: createGame, name: $('#create-name').value, max: $('#create-max').value }, (r) => {
    if (r.error) return toast(r.error);
    $('#modal').classList.add('hidden');
  });
});

// ---------- Mesa ----------
$('#leave-room').addEventListener('click', () => App.socket.emit('room:leave'));

function renderRoom() {
  const st = App.room;
  if (!st) return;
  $('#room-title').textContent = st.name;
  const g = st.game;
  const count = g.seats.filter((s) => !s.left).length;
  $('#room-sub').textContent = `${st.type === 'poker' ? "Texas Hold'em" : 'Blackjack'} · ${count}/${st.max} jugadores · Anfitrión: ${st.host}`;
  if (st.type === 'poker') PokerUI.render(st);
  else BlackjackUI.render(st);
}

function act(action, data = {}) {
  App.socket.emit('game:action', { action, ...data }, (r) => { if (r && r.error) toast(r.error); });
}

// ---------- Chat ----------
function addChat(sel, m) {
  const box = $(sel);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const div = document.createElement('div');
  if (m.system) {
    div.className = 'msg system';
    div.textContent = m.text;
  } else {
    div.className = 'msg' + (m.name === App.me.name ? ' mine' : '');
    const time = new Date(m.ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `${avatarHTML(m.name, 'xs')}<div><div class="msg-head">${m.admin || isAdminName(m.name) ? `<b class="admin-name">${esc(m.name)}</b><span class="admin-badge">ADMIN</span>` : `<b style="color:${colorFor(m.name)}">${esc(m.name)}</b>`}<time>${time}</time></div><div class="msg-text"></div></div>`;
    div.querySelector('.msg-text').textContent = m.text;
  }
  box.appendChild(div);
  while (box.children.length > 100) box.firstChild.remove();
  if (atBottom || m.name === App.me.name) box.scrollTop = box.scrollHeight;
}
$$('.chat-form').forEach((f) => f.addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = f.querySelector('input');
  const text = inp.value.trim();
  if (!text || !App.socket) return;
  App.socket.emit('chat:send', { scope: f.dataset.scope, text });
  inp.value = '';
}));

// ---------- Panel de administración ----------
function fmtDate(ts) {
  return new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const BAN_OPTIONS = [[5, '5 min'], [30, '30 min'], [60, '1 hora'], [360, '6 horas'], [1440, '1 día'], [10080, '7 días'], [43200, '30 días']];
const Admin = {
  users: [],
  timer: null,
  load() {
    if (!App.socket) return;
    App.socket.emit('admin:users', (r) => {
      if (r.error) { toast(r.error); return; }
      this.users = r.users;
      this.render();
    });
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (App.view === 'admin') this.refreshQuiet(); else clearInterval(this.timer); }, 5000);
  },
  refreshQuiet() {
    // No re-renderiza si estás escribiendo en una casilla
    if (document.activeElement && document.activeElement.closest('#admin-users')) return;
    App.socket.emit('admin:users', (r) => { if (!r.error) { this.users = r.users; this.render(); } });
  },
  render() {
    const q = $('#admin-search').value.trim().toLowerCase();
    const list = this.users.filter((u) => u.name.toLowerCase().includes(q));
    const online = this.users.filter((u) => u.online).length;
    const banned = this.users.filter((u) => u.bannedUntil).length;
    $('#admin-stats').innerHTML = `<div><b>${this.users.length}</b><span>cuentas</span></div><div><b>${online}</b><span>conectados</span></div><div><b>${banned}</b><span>baneados</span></div>`;
    $('#admin-users').innerHTML = list.map((u) => {
      const me = u.name === App.me.name;
      const status = u.bannedUntil
        ? `<span class="tag ban">Baneado hasta ${fmtDate(u.bannedUntil)}</span>`
        : u.online ? `<span class="tag on">● Conectado${u.inRoom ? ' · en mesa' : ''}</span>` : '<span class="tag off">Desconectado</span>';
      const protectedUser = me || u.isAdmin;
      return `<tr data-user="${esc(u.name)}">
        <td><div class="au">${avatarHTML(u.name, 'sm')}<b class="${u.isAdmin ? 'admin-name' : ''}">${esc(u.name)}</b>${u.isAdmin ? '<span class="admin-badge">ADMIN</span>' : ''}${me ? '<span class="tag you">tú</span>' : ''}</div></td>
        <td>${status}</td>
        <td><div class="chips-edit"><input type="number" min="0" value="${u.chips}" class="chips-in"><button class="btn gold small" data-act="chips">Poner</button></div></td>
        <td>${protectedUser ? '<span class="muted">—</span>' : u.bannedUntil
          ? '<button class="btn green small" data-act="unban">Quitar ban</button>'
          : `<div class="ban-edit"><select class="ban-sel">${BAN_OPTIONS.map(([m, l]) => `<option value="${m}">${l}</option>`).join('')}</select><button class="btn danger small" data-act="ban">Banear</button></div>`}</td>
        <td>${protectedUser ? '' : '<button class="btn ghost small del" data-act="delete" title="Eliminar cuenta">🗑️ Eliminar</button>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No hay usuarios</td></tr>';
  },
  action(btn) {
    const tr = btn.closest('tr');
    const user = tr.dataset.user;
    const act = btn.dataset.act;
    const done = (msg) => (r) => { if (r.error) toast(r.error); else { toast(msg, 'ok'); this.load(); } };
    if (act === 'chips') {
      const chips = Number(tr.querySelector('.chips-in').value);
      App.socket.emit('admin:setChips', { user, chips }, done(`${user} ahora tiene ${fmt(chips)} fichas`));
    } else if (act === 'ban') {
      const sel = tr.querySelector('.ban-sel');
      const label = sel.options[sel.selectedIndex].text;
      if (!confirm(`¿Banear a ${user} durante ${label}?`)) return;
      App.socket.emit('admin:ban', { user, minutes: +sel.value }, done(`${user} baneado durante ${label}`));
    } else if (act === 'unban') {
      App.socket.emit('admin:unban', { user }, done(`${user} ya no está baneado`));
    } else if (act === 'delete') {
      if (!confirm(`¿Eliminar la cuenta de ${user} para siempre? No se puede deshacer.`)) return;
      App.socket.emit('admin:delete', { user }, done(`Cuenta de ${user} eliminada`));
    }
  },
};
$('#admin-users').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) Admin.action(b); });
$('#admin-users').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('chips-in')) Admin.action(e.target.closest('tr').querySelector('[data-act=chips]'));
});
$('#admin-search').addEventListener('input', () => Admin.render());
$('#admin-refresh').addEventListener('click', () => Admin.load());

// ---------- Arranque ----------
window.addEventListener('DOMContentLoaded', () => {
  const token = store.get('rc_token');
  if (token) connect(token);
  else show('auth');
});
