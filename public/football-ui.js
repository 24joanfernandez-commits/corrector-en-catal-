// ================= Apuestas de fútbol con partido animado =================
const Football = (() => {
  const canvas = $('#pitch');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const FX = 34, FY = 30, FW = W - FX * 2, FH = H - FY * 2; // rectángulo del campo
  const px = (x) => FX + x * FW, py = (y) => FY + y * FH;
  const GOAL_HALF = 0.06; // media portería (en proporción del ancho del campo)
  const MATCH_MS = 30000; // 90 minutos en 30 segundos

  let teams = [], byId = {};
  const sel = { home: 'psg', away: 'bar', pick: '1' };
  let info = null;
  let fixtures = [];

  // ---------- Simulación del campo ----------
  const FORMATION = [[0.04, 0.5, 'gk'], [0.2, 0.3], [0.2, 0.7], [0.36, 0.38], [0.36, 0.62], [0.47, 0.25], [0.47, 0.75]];
  let players = [];
  const ball = { x: 0.5, y: 0.5, owner: null, flight: null };
  let holdT = 0;
  let script = null; // secuencia de gol en curso
  let match = null;  // partido con apuesta en juego
  let lastT = 0, raf = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  const dirOf = (team) => (team === 'home' ? 1 : -1);

  function buildPlayers() {
    players = [];
    for (const team of ['home', 'away']) {
      FORMATION.forEach(([fx, fy, role], i) => {
        const x = team === 'home' ? fx : 1 - fx;
        players.push({ team, role: role || 'out', num: i === 0 ? 1 : i + 1, fx: x, fy, x, y: fy, tx: x, ty: fy });
      });
    }
  }

  function kickoff(teamWithBall) {
    for (const p of players) {
      // Para el saque, cada equipo en su campo
      p.x = p.team === 'home' ? Math.min(p.fx, 0.46) : Math.max(p.fx, 0.54);
      p.y = p.fy;
    }
    const taker = players.find((p) => p.team === teamWithBall && p.num === 6);
    taker.x = 0.5; taker.y = 0.5;
    ball.x = 0.5; ball.y = 0.5; ball.flight = null; ball.owner = taker;
    holdT = 0.6;
  }

  function teammates(p) { return players.filter((q) => q.team === p.team && q !== p); }
  function opponents(p) { return players.filter((q) => q.team !== p.team); }
  function nearest(list, x, y) {
    let best = null, bd = Infinity;
    for (const q of list) { const d = Math.hypot(q.x - x, (q.y - y) * 0.65); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  function kick(tx, ty, kind, receiver, speed = 0.75) {
    const d = Math.hypot(tx - ball.x, (ty - ball.y) * 0.65);
    ball.flight = { sx: ball.x, sy: ball.y, tx, ty, t: 0, dur: Math.max(0.22, d / speed), kind, receiver };
    ball.owner = null;
  }

  function decide() {
    const p = ball.owner;
    const dir = dirOf(p.team);
    const attacking = dir * (p.x - 0.5);
    const r = Math.random();
    if (p.role !== 'gk' && attacking > 0.25 && r < 0.4) {
      // Disparo que no entra: fuera o parada del portero
      const goalX = p.team === 'home' ? 1 : 0;
      const keeper = players.find((q) => q.team !== p.team && q.role === 'gk');
      if (Math.random() < 0.5) {
        const side = Math.random() < 0.5 ? -1 : 1;
        kick(goalX + dir * 0.01, 0.5 + side * rand(GOAL_HALF + 0.02, 0.2), 'wide', keeper, 1.1);
      } else {
        kick(keeper.x, keeper.y + rand(-0.02, 0.02), 'saved', keeper, 1.1);
      }
      if (match) feed(`${Math.floor(match.minute)}' 🥅 Disparo de ${byId[match[p.team]].short}`, 'shot');
      return;
    }
    if (p.role !== 'gk' && r < 0.55) {
      const opp = nearest(opponents(p).filter((q) => q.role !== 'gk'), p.x + dir * 0.1, p.y);
      kick(opp.x, opp.y, 'pass', opp, 0.7); // pase interceptado
      return;
    }
    let options = teammates(p).filter((q) => q.role !== 'gk' && dir * (q.x - p.x) > -0.08);
    if (!options.length) options = teammates(p).filter((q) => q.role !== 'gk');
    const to = options[Math.floor(Math.random() * options.length)];
    kick(to.x + dir * 0.03, to.y, 'pass', to);
  }

  // ---------- Secuencia de gol ----------
  function startGoal(goal) {
    const team = goal.team;
    const dir = dirOf(team);
    const goalX = team === 'home' ? 1 : 0;
    const strikers = players.filter((q) => q.team === team && q.num >= 6);
    const scorer = strikers[Math.floor(Math.random() * strikers.length)];
    const spot = { x: goalX - dir * rand(0.12, 0.2), y: rand(0.35, 0.65) };
    script = { goal, scorer, stage: 'pass', spot };
    match.frozenAt = goal.min;
    kick(spot.x, spot.y, 'pass', scorer, 1.0);
    scorer.sprint = spot;
  }

  function goalScored() {
    const g = script.goal;
    match.score[g.team]++;
    const t = byId[match[g.team]];
    updateScoreboard();
    feed(`${g.min}' ⚽ ¡GOL de ${t.name}! (${match.score.home}-${match.score.away})`, 'goal');
    const flash = $('#goal-flash');
    flash.innerHTML = `<div class="gf-text">¡GOOOL!</div><div class="gf-team" style="--c1:${t.c1};--c2:${t.c2}">${esc(t.name)}</div>`;
    flash.classList.remove('show'); void flash.offsetWidth; flash.classList.add('show');
    Sound.play('victory');
    script.stage = 'celebrate';
    script.until = performance.now() + 2200;
  }

  // ---------- Bucle principal ----------
  function step(dt, now) {
    if (match && !match.ended) {
      if (match.frozenAt != null) match.minute = match.frozenAt;
      else match.minute = Math.min(90, match.minute + (dt * 1000 * 90) / MATCH_MS);
      $('#sb-clock').textContent = `${Math.floor(match.minute)}'`;
      if (!script && !match.halftime && match.minute >= 45) { match.halftime = true; feed("45' Descanso", 'info'); }
      const next = match.goals[match.goalIdx];
      if (!script && next && match.minute >= next.min) { match.goalIdx++; startGoal(next); }
      if (!script && !next && match.minute >= 90) return endMatch();
    }

    if (script && script.stage === 'celebrate') {
      if (now > script.until) {
        const conceding = script.goal.team === 'home' ? 'away' : 'home';
        script = null;
        if (match) match.frozenAt = null;
        kickoff(conceding);
      }
      return;
    }

    // Balón
    if (ball.flight) {
      const f = ball.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = 1 - Math.pow(1 - k, 2);
      ball.x = f.sx + (f.tx - f.sx) * e;
      ball.y = f.sy + (f.ty - f.sy) * e;
      if (k >= 1) {
        ball.flight = null;
        if (f.kind === 'goal') return goalScored();
        if (f.kind === 'wide') { const gk = f.receiver; ball.x = gk.x; ball.y = gk.y; }
        ball.owner = f.receiver;
        holdT = rand(0.35, 0.9);
        if (script && script.stage === 'pass' && f.receiver === script.scorer) { script.stage = 'shoot'; holdT = 0.25; }
      }
    } else if (ball.owner) {
      const o = ball.owner;
      ball.x = o.x + dirOf(o.team) * 0.012;
      ball.y = o.y + 0.006;
      holdT -= dt;
      if (holdT <= 0) {
        if (script && script.stage === 'shoot' && o === script.scorer) {
          const goalX = o.team === 'home' ? 1 : 0;
          kick(goalX + dirOf(o.team) * 0.018, 0.5 + rand(-GOAL_HALF * 0.7, GOAL_HALF * 0.7), 'goal', null, 1.3);
          script.stage = 'flying';
        } else if (!script) decide();
        else holdT = 0.2;
      }
    }

    // Jugadores
    const owner = ball.owner;
    const attackingTeam = owner ? owner.team : ball.flight && ball.flight.receiver ? ball.flight.receiver.team : null;
    const shift = (ball.x - 0.5) * 0.55;
    const chasers = new Set();
    for (const team of ['home', 'away']) {
      if (team === attackingTeam) continue;
      const c = nearest(players.filter((q) => q.team === team && q.role !== 'gk'), ball.x, ball.y);
      if (c) chasers.add(c);
    }
    for (const p of players) {
      let tx, ty, speed = 0.13;
      if (p.role === 'gk') {
        tx = p.fx + (p.team === 'home' ? 1 : -1) * Math.max(0, (p.team === 'home' ? 0.5 - ball.x : ball.x - 0.5)) * 0.03;
        ty = 0.5 + (ball.y - 0.5) * 0.35;
      } else if (p === owner) {
        tx = p.x + dirOf(p.team) * 0.08; ty = p.y + (0.5 - p.y) * 0.1; speed = 0.09;
      } else if (p.sprint && script) {
        tx = p.sprint.x; ty = p.sprint.y; speed = 0.42;
      } else if (chasers.has(p)) {
        tx = ball.x; ty = ball.y; speed = 0.17;
      } else {
        const push = p.team === attackingTeam ? dirOf(p.team) * 0.08 : 0;
        tx = p.fx + shift + push; ty = p.fy + (ball.y - p.fy) * 0.22;
      }
      tx = Math.max(0.02, Math.min(0.98, tx)); ty = Math.max(0.04, Math.min(0.96, ty));
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      const m = Math.min(d, speed * dt);
      if (d > 0.0001) { p.x += (dx / d) * m; p.y += (dy / d) * m; }
      if (!script) p.sprint = null;
    }
  }

  // ---------- Dibujo ----------
  function drawPitch() {
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#2e8b47' : '#329a4f';
      ctx.fillRect(FX + (FW / 12) * i, FY, FW / 12 + 1, FH);
    }
    ctx.fillStyle = '#26743b';
    ctx.fillRect(0, 0, W, FY); ctx.fillRect(0, H - FY, W, FY); ctx.fillRect(0, 0, FX, H); ctx.fillRect(W - FX, 0, FX, H);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
    ctx.strokeRect(FX, FY, FW, FH);
    ctx.beginPath(); ctx.moveTo(px(0.5), FY); ctx.lineTo(px(0.5), FY + FH); ctx.stroke();
    ctx.beginPath(); ctx.arc(px(0.5), py(0.5), FW * 0.087, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px(0.5), py(0.5), 3, 0, Math.PI * 2); ctx.fill();
    for (const side of [0, 1]) {
      const s = side ? -1 : 1, x0 = side ? FX + FW : FX;
      const bw = FH * 0.593, bd = FW * 0.157, gw = FH * 0.269, gd = FW * 0.052;
      ctx.strokeRect(side ? x0 - bd : x0, py(0.5) - bw / 2, bd, bw);
      ctx.strokeRect(side ? x0 - gd : x0, py(0.5) - gw / 2, gd, gw);
      ctx.beginPath(); ctx.arc(x0 + s * FW * 0.105, py(0.5), 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x0 + s * FW * 0.105, py(0.5), FW * 0.087, side ? Math.PI - 0.93 : -0.93, side ? Math.PI + 0.93 : 0.93);
      ctx.save(); ctx.beginPath(); ctx.rect(side ? FX : x0 + bd, FY, side ? FW - bd : FW, FH); ctx.clip();
      ctx.beginPath(); ctx.arc(x0 + s * FW * 0.105, py(0.5), FW * 0.087, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      // Portería con red
      const gh = FH * GOAL_HALF * 2, gx = side ? x0 : x0 - 16;
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(gx, py(0.5) - gh / 2, 16, gh);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      for (let k = 0; k <= gh; k += 6) { ctx.beginPath(); ctx.moveTo(gx, py(0.5) - gh / 2 + k); ctx.lineTo(gx + 16, py(0.5) - gh / 2 + k); ctx.stroke(); }
      for (let k = 0; k <= 16; k += 5) { ctx.beginPath(); ctx.moveTo(gx + k, py(0.5) - gh / 2); ctx.lineTo(gx + k, py(0.5) + gh / 2); ctx.stroke(); }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(gx, py(0.5) - gh / 2, 16, gh);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = '#fff';
    }
  }

  function teamColors(team) {
    const t = byId[match ? match[team] : sel[team]];
    return t || { c1: team === 'home' ? '#2563eb' : '#dc2626', c2: '#fff' };
  }

  function draw() {
    drawPitch();
    const hc = teamColors('home'), ac = teamColors('away');
    for (const p of players) {
      const c = p.team === 'home' ? hc : ac;
      const x = px(p.x), y = py(p.y);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(x + 2, y + 9, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Camiseta: color principal con rayas del secundario
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = p.role === 'gk' ? (p.team === 'home' ? '#f59e0b' : '#a3e635') : c.c1;
      ctx.fillRect(x - 12, y - 12, 24, 24);
      if (p.role !== 'gk') { ctx.fillStyle = c.c2; ctx.fillRect(x - 7, y - 12, 4, 24); ctx.fillRect(x + 3, y - 12, 4, 24); }
      ctx.restore();
      // Borde: blanco el local, negro el visitante (así nunca se confunden)
      ctx.lineWidth = 3; ctx.strokeStyle = p.team === 'home' ? '#ffffff' : '#0b0b0f';
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      if (p === ball.owner) { ctx.lineWidth = 2; ctx.strokeStyle = '#ffe066'; ctx.beginPath(); ctx.arc(x, y, 16.5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(String(p.num), x, y + 0.5);
      ctx.fillStyle = '#fff'; ctx.fillText(String(p.num), x, y + 0.5);
    }
    // Balón (sube un poco en los pases largos)
    let lift = 0;
    if (ball.flight) { const k = Math.min(1, ball.flight.t / ball.flight.dur); lift = Math.sin(k * Math.PI) * Math.min(14, ball.flight.dur * 18); }
    const bx = px(ball.x), by = py(ball.y);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(bx + 2, by + 4, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(bx - 2, by - 2 - lift, 1, bx, by - lift, 6);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#bbb');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by - lift, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(bx, by - lift, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  function loop(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    step(dt, t);
    draw();
    raf = App.view === 'football' || (match && !match.ended) ? requestAnimationFrame(loop) : null;
  }

  // ---------- Partido con apuesta ----------
  function feed(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'fb-ev ' + kind;
    el.textContent = text;
    const box = $('#fb-feed');
    box.prepend(el);
    while (box.children.length > 30) box.lastChild.remove();
  }

  function crest(t, big = '') {
    return t ? `<span class="crest ${big}" style="--c1:${t.c1};--c2:${t.c2}">${esc(t.short)}</span>` : '';
  }

  function updateScoreboard() {
    const h = byId[match ? match.home : sel.home], a = byId[match ? match.away : sel.away];
    $('#sb-home').innerHTML = `${crest(h, 'big')}<b>${esc(h ? h.name : '—')}</b>`;
    $('#sb-away').innerHTML = `<b>${esc(a ? a.name : '—')}</b>${crest(a, 'big')}`;
    $('#sb-hg').textContent = match ? match.score.home : '-';
    $('#sb-ag').textContent = match ? match.score.away : '-';
    if (!match) $('#sb-clock').textContent = 'Previa';
  }

  function endMatch() {
    match.ended = true;
    const r = match.r;
    feed(`90' Final del partido: ${byId[r.home].short} ${r.homeGoals}-${r.awayGoals} ${byId[r.away].short}`, 'info');
    $('#sb-clock').textContent = 'FINAL';
    Sound.play('turn');
    const net = r.payout - r.amount;
    setTimeout(() => {
      showResult(net > 0 ? 'victory' : 'defeat', net);
      App.me.chips = r.chips;
      setChips(r.chips, true);
      api.playing = false;
      setControls(true);
    }, 700);
  }

  function setControls(on) {
    for (const el of $$('#fb-home, #fb-away, #fb-amount, #fb-bet, #fb-picks button, .fb-quick button, #fb-fixtures button')) el.disabled = !on;
  }

  // ---------- Panel de apuesta ----------
  function teamOptions(selected) {
    return teams.slice().sort((a, b) => b.rating - a.rating)
      .map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)} · ${t.rating}</option>`).join('');
  }

  function renderPanel() {
    $('#fb-home').innerHTML = teamOptions(sel.home);
    $('#fb-away').innerHTML = teamOptions(sel.away);
    const h = byId[sel.home], a = byId[sel.away];
    const bar = (t) => `<div class="fb-rt"><span>${crest(t)} ${esc(t.short)}</span><div class="fb-rbar"><i style="width:${Math.max(6, (t.rating - 65) / 30 * 100)}%;--c1:${t.c1}"></i></div><b>${t.rating}</b></div>`;
    $('#fb-strength').innerHTML = h && a ? bar(h) + bar(a) : '';
    if (info) {
      const p = info.probs;
      $('#fb-prob').innerHTML = `<i style="width:${p['1'] * 100}%;background:${h.c1 === '#ffffff' ? h.c2 : h.c1}">${Math.round(p['1'] * 100)}%</i><i class="x" style="width:${p.X * 100}%">${Math.round(p.X * 100)}%</i><i style="width:${p['2'] * 100}%;background:${a.c1 === '#ffffff' ? a.c2 : a.c1}">${Math.round(p['2'] * 100)}%</i>`;
      const labels = { 1: `Gana ${h.short}`, X: 'Empate', 2: `Gana ${a.short}` };
      $('#fb-picks').innerHTML = ['1', 'X', '2'].map((k) => `<button class="fb-pick ${sel.pick === k ? 'sel' : ''}" data-pick="${k}"><span>${labels[k]}</span><b>${info.odds[k].toFixed(2)}</b></button>`).join('');
    }
    updateWin();
    if (!match || match.ended) updateScoreboard();
  }

  function updateWin() {
    const amt = Math.floor(+$('#fb-amount').value || 0);
    $('#fb-win').textContent = info ? fmt(Math.floor(amt * info.odds[sel.pick])) : '0';
  }

  function loadInfo() {
    if (sel.home === sel.away) { info = null; renderPanel(); return; }
    App.socket.emit('football:info', { home: sel.home, away: sel.away }, (r) => {
      if (r.error) return;
      info = r;
      renderPanel();
    });
  }

  function renderFixtures() {
    $('#fb-fixtures').innerHTML = fixtures.map((f, i) => {
      const h = byId[f.home], a = byId[f.away];
      return `<button class="fb-fx" data-fx="${i}">
        <span class="fx-t">${crest(h)}<b>${esc(h.name)}</b></span>
        <span class="fx-odds"><i>${f.odds['1'].toFixed(2)}</i><i>${f.odds.X.toFixed(2)}</i><i>${f.odds['2'].toFixed(2)}</i></span>
        <span class="fx-t r"><b>${esc(a.name)}</b>${crest(a)}</span>
      </button>`;
    }).join('');
  }

  $('#fb-home').addEventListener('change', (e) => { sel.home = e.target.value; if (sel.home === sel.away) toast('Elige dos equipos distintos'); loadInfo(); });
  $('#fb-away').addEventListener('change', (e) => { sel.away = e.target.value; if (sel.home === sel.away) toast('Elige dos equipos distintos'); loadInfo(); });
  $('#fb-swap').addEventListener('click', () => { [sel.home, sel.away] = [sel.away, sel.home]; loadInfo(); });
  $('#fb-picks').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; sel.pick = b.dataset.pick; renderPanel(); });
  $('#fb-amount').addEventListener('input', updateWin);
  $$('.fb-quick button').forEach((b) => b.addEventListener('click', () => {
    $('#fb-amount').value = b.dataset.q === 'all' ? App.me.chips : b.dataset.q;
    updateWin();
  }));
  $('#fb-fixtures').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fx]');
    if (!b || api.playing) return;
    const f = fixtures[+b.dataset.fx];
    sel.home = f.home; sel.away = f.away;
    loadInfo();
  });
  $('#fb-refresh').addEventListener('click', () => App.socket.emit('football:fixtures', (r) => { fixtures = r.fixtures; renderFixtures(); }));

  $('#fb-bet').addEventListener('click', () => {
    if (api.playing) return;
    const amount = Math.floor(+$('#fb-amount').value);
    if (!amount || amount < 1) return toast('Pon cuántas fichas apuestas');
    if (amount > App.me.chips) return toast('No tienes suficientes fichas');
    if (sel.home === sel.away) return toast('Elige dos equipos distintos');
    api.playing = true;
    setControls(false);
    App.socket.emit('football:bet', { home: sel.home, away: sel.away, pick: sel.pick, amount }, (r) => {
      if (r.error) { api.playing = false; setControls(true); toast(r.error); return; }
      setChips(App.me.chips - r.amount, true);
      Sound.play('chip');
      match = {
        r, home: r.home, away: r.away, goals: r.goals, goalIdx: 0,
        score: { home: 0, away: 0 }, minute: 0, frozenAt: null, halftime: false, ended: false,
      };
      script = null;
      $('#fb-feed').innerHTML = '';
      const pickTxt = r.pick === 'X' ? 'empate' : byId[r.pick === '1' ? r.home : r.away].name;
      feed(`Apuestas ${fmt(r.amount)} fichas a ${pickTxt} (cuota ${r.odds[r.pick].toFixed(2)})`, 'mybet');
      feed("0' ¡Pitido inicial!", 'info');
      updateScoreboard();
      buildPlayers();
      kickoff('home');
      if (!raf) { lastT = 0; raf = requestAnimationFrame(loop); }
    });
  });

  buildPlayers();
  kickoff('home');

  const api = {
    playing: false,
    onShow() {
      if (!teams.length && App.socket) {
        App.socket.emit('football:teams', (r) => {
          teams = r.teams;
          byId = Object.fromEntries(teams.map((t) => [t.id, t]));
          fixtures = r.fixtures;
          renderFixtures();
          loadInfo();
        });
      }
      if (!raf) { lastT = 0; raf = requestAnimationFrame(loop); }
    },
  };
  return api;
})();
