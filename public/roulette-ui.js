// ================= Ruleta europea =================
const Roulette = (() => {
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const SEG = (Math.PI * 2) / 37;
  const CHIPS = [10, 50, 100, 500, 1000];
  const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

  const canvas = $('#wheel');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, C = W / 2, R = W / 2 - 8;
  const R_TRACK = R * 0.885, R_POCKET = R * 0.66;

  const state = {
    wheel: 0, ball: -Math.PI / 2, ballR: R_TRACK, restIdx: null,
    anim: null, raf: null, lastT: 0,
  };
  let bets = new Map();   // clave -> fichas
  let lastBets = null;
  let chipValue = 10;
  const history = [];

  // ---------- Dibujo de la rueda ----------
  function draw() {
    ctx.clearRect(0, 0, W, W);
    // Marco de madera
    let g = ctx.createRadialGradient(C, C, R * 0.8, C, C, R);
    g.addColorStop(0, '#5a3214'); g.addColorStop(0.6, '#8a5224'); g.addColorStop(1, '#3a1d0a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fill();
    // Pista de la bola
    g = ctx.createRadialGradient(C, C, R * 0.8, C, C, R * 0.95);
    g.addColorStop(0, '#1b1b1f'); g.addColorStop(1, '#3a3a40');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R * 0.94, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(245,196,81,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(C, C, R * 0.94, 0, Math.PI * 2); ctx.stroke();

    // Casillas
    const r1 = R * 0.6, r2 = R * 0.83;
    for (let i = 0; i < 37; i++) {
      const n = ORDER[i];
      const a0 = state.wheel + i * SEG - SEG / 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(C, C, r2, a0, a0 + SEG);
      ctx.arc(C, C, r1, a0 + SEG, a0, true);
      ctx.closePath();
      ctx.fillStyle = n === 0 ? '#0f8a4a' : REDS.has(n) ? '#c8102e' : '#141418';
      if (state.restIdx === i && !state.anim) ctx.fillStyle = n === 0 ? '#22c76f' : REDS.has(n) ? '#ff3b55' : '#3a3a48';
      ctx.fill();
      ctx.strokeStyle = '#d4a93a'; ctx.lineWidth = 1.2; ctx.stroke();
      // Número
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(a0 + SEG / 2 + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(R * 0.062)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 0, -(r2 - R * 0.06));
      ctx.restore();
    }
    // Separadores de los huecos
    ctx.strokeStyle = '#e6c25a'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 37; i++) {
      const a = state.wheel + i * SEG - SEG / 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * R * 0.52, C + Math.sin(a) * R * 0.52);
      ctx.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(C, C, R * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a30'; ctx.fill();
    // Cono central
    g = ctx.createRadialGradient(C - R * 0.1, C - R * 0.1, 0, C, C, R * 0.5);
    g.addColorStop(0, '#c08a46'); g.addColorStop(0.7, '#6b3d18'); g.addColorStop(1, '#3d200b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R * 0.48, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d4a93a'; ctx.lineWidth = 3; ctx.stroke();
    // Torreta
    ctx.save();
    ctx.translate(C, C); ctx.rotate(state.wheel);
    const tg = ctx.createLinearGradient(-R * 0.3, 0, R * 0.3, 0);
    tg.addColorStop(0, '#9c7a2b'); tg.addColorStop(0.5, '#ffe9a3'); tg.addColorStop(1, '#9c7a2b');
    ctx.fillStyle = tg;
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-R * 0.025, 0); ctx.lineTo(-R * 0.012, -R * 0.33); ctx.lineTo(R * 0.012, -R * 0.33); ctx.lineTo(R * 0.025, 0);
      ctx.fill();
      ctx.beginPath(); ctx.arc(0, -R * 0.33, R * 0.03, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Bola
    const bx = C + Math.cos(state.ball - Math.PI / 2) * state.ballR;
    const by = C + Math.sin(state.ball - Math.PI / 2) * state.ballR;
    ctx.beginPath(); ctx.arc(bx + 2, by + 3, R * 0.032, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    const bg = ctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, R * 0.034);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#a9adb8');
    ctx.beginPath(); ctx.arc(bx, by, R * 0.032, 0, Math.PI * 2);
    ctx.fillStyle = bg; ctx.fill();
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  function bounce(t) {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }

  function loop(t) {
    const dt = state.lastT ? Math.min(0.05, (t - state.lastT) / 1000) : 0;
    state.lastT = t;
    const a = state.anim;
    if (a) {
      const p = Math.min(1, (t - a.start) / a.dur);
      state.wheel = a.w0 + a.wTurn * easeOutCubic(p);
      const q = Math.min(1, p / 0.8);
      state.ball = state.wheel + a.idx * SEG + a.D * (1 - easeOutQuart(q));
      if (p < 0.5) state.ballR = R_TRACK;
      else if (p < 0.82) state.ballR = R_TRACK - (R_TRACK - R_POCKET) * bounce((p - 0.5) / 0.32);
      else state.ballR = R_POCKET;
      if (p > 0.5 && p < 0.85 && Math.random() < 0.12) Sound.play('tick');
      if (p >= 1) { state.anim = null; state.restIdx = a.idx; a.done(); }
    } else {
      // Giro lento en reposo
      state.wheel += dt * 0.25;
      if (state.restIdx !== null) state.ball = state.wheel + state.restIdx * SEG;
      else state.ball -= dt * 0.25;
    }
    draw();
    state.raf = App.view === 'roulette' ? requestAnimationFrame(loop) : null;
  }

  function spinTo(number, done) {
    const idx = ORDER.indexOf(number);
    const w0 = state.wheel;
    const target = w0 + idx * SEG;
    const TAU = Math.PI * 2;
    const diff = (((state.ball - target) % TAU) + TAU) % TAU;
    state.restIdx = null;
    state.ballR = R_TRACK;
    state.anim = {
      start: performance.now(), dur: 7500, w0, wTurn: TAU * 2.2,
      idx, D: diff + TAU * 6, done,
    };
  }

  // ---------- Tablero de apuestas ----------
  function buildBoard() {
    let h = '<div class="cell zero green" data-key="n:0" style="grid-column:1;grid-row:1/4">0</div>';
    for (let c = 1; c <= 12; c++) for (let r = 1; r <= 3; r++) {
      const n = 3 * c - (r - 1);
      h += `<div class="cell num ${colorOf(n)}" data-key="n:${n}" style="grid-column:${c + 1};grid-row:${r}">${n}</div>`;
    }
    for (let r = 1; r <= 3; r++) h += `<div class="cell out" data-key="col:${4 - r}" style="grid-column:14;grid-row:${r}">2:1</div>`;
    ['1ª docena', '2ª docena', '3ª docena'].forEach((t, i) => {
      h += `<div class="cell out" data-key="dozen:${i + 1}" style="grid-column:${2 + i * 4}/span 4;grid-row:4">${t}</div>`;
    });
    [['low', '1-18'], ['even', 'PAR'], ['red', '<i class="dia red"></i>'], ['black', '<i class="dia black"></i>'], ['odd', 'IMPAR'], ['high', '19-36']].forEach(([k, t], i) => {
      h += `<div class="cell out" data-key="${k}" style="grid-column:${2 + i * 2}/span 2;grid-row:5">${t}</div>`;
    });
    $('#rl-board').innerHTML = h;
    $('#chip-select').innerHTML = CHIPS.map((v) => `<button class="bchip v${v} ${v === chipValue ? 'sel' : ''}" data-chip="${v}">${v >= 1000 ? '1K' : v}</button>`).join('');
  }

  function totalBet() { let t = 0; for (const v of bets.values()) t += v; return t; }

  function renderBets() {
    for (const cell of $$('#rl-board .cell')) {
      const v = bets.get(cell.dataset.key);
      let tag = cell.querySelector('.placed');
      if (v) {
        if (!tag) { tag = document.createElement('span'); tag.className = 'placed'; cell.appendChild(tag); }
        tag.textContent = v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K' : v;
      } else if (tag) tag.remove();
    }
    $('#rl-total').textContent = fmt(totalBet());
  }

  function toServer() {
    return [...bets].map(([k, a]) => {
      const [t, v] = k.split(':');
      return { t, v: v != null ? +v : null, a };
    });
  }

  function addHistory(n) {
    history.unshift(n);
    if (history.length > 12) history.pop();
    $('#last-numbers').innerHTML = history.map((x, i) => `<span class="ln ${colorOf(x)} ${i === 0 ? 'new' : ''}">${x}</span>`).join('');
  }

  // ---------- Eventos ----------
  $('#rl-board').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || api.spinning) return;
    if (totalBet() + chipValue > App.me.chips) { toast('No tienes suficientes fichas'); return; }
    bets.set(cell.dataset.key, (bets.get(cell.dataset.key) || 0) + chipValue);
    Sound.play('chip');
    $$('#rl-board .cell.hit').forEach((c) => c.classList.remove('hit'));
    renderBets();
  });
  $('#rl-board').addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    if (api.spinning) return;
    const v = (bets.get(cell.dataset.key) || 0) - chipValue;
    if (v > 0) bets.set(cell.dataset.key, v); else bets.delete(cell.dataset.key);
    renderBets();
  });
  $('#chip-select').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    chipValue = +b.dataset.chip;
    $$('#chip-select .bchip').forEach((x) => x.classList.toggle('sel', x === b));
  });
  $('#rl-clear').addEventListener('click', () => { if (!api.spinning) { bets.clear(); renderBets(); } });
  $('#rl-repeat').addEventListener('click', () => {
    if (api.spinning || !lastBets) return;
    const t = [...lastBets.values()].reduce((a, b) => a + b, 0);
    if (t > App.me.chips) { toast('No tienes suficientes fichas'); return; }
    bets = new Map(lastBets);
    renderBets();
  });
  $('#rl-spin').addEventListener('click', () => {
    if (api.spinning) return;
    const total = totalBet();
    if (!total) { toast('Pon alguna ficha en el tablero'); return; }
    api.spinning = true;
    $('#rl-spin').disabled = true;
    App.socket.emit('roulette:spin', { bets: toServer() }, (r) => {
      if (r.error) { api.spinning = false; $('#rl-spin').disabled = false; toast(r.error); return; }
      setChips(App.me.chips - r.total, true);
      $$('#rl-board .cell.hit').forEach((c) => c.classList.remove('hit'));
      spinTo(r.number, () => {
        api.spinning = false;
        $('#rl-spin').disabled = false;
        addHistory(r.number);
        const cell = $(`#rl-board [data-key="n:${r.number}"]`);
        if (cell) cell.classList.add('hit');
        const net = r.payout - r.total;
        showResult(net > 0 ? 'victory' : net === 0 ? 'push' : 'defeat', net);
        App.me.chips = r.chips;
        setChips(r.chips, true);
        lastBets = new Map(bets);
        bets.clear();
        renderBets();
      });
    });
  });

  buildBoard();
  draw();

  const api = {
    spinning: false,
    onShow() { if (!state.raf) { state.lastT = 0; state.raf = requestAnimationFrame(loop); } },
  };
  return api;
})();
