// ================= Interfaz del póker =================
const PokerUI = {
  handId: null,

  render(st) {
    const g = st.game;
    if (g.handId !== this.handId) { Cards.reset(); this.handId = g.handId; }
    const n = g.seats.length || 1;
    const base = g.you >= 0 ? g.you : 0;
    const winSet = new Set((g.result && g.result.winCards) || []);
    const showdown = g.phase === 'showdown';

    let seatsHTML = '', betsHTML = '';
    g.seats.forEach((s, i) => {
      const rel = (i - base + n) % n;
      const ang = Math.PI / 2 + (rel * 2 * Math.PI) / n;
      const x = 50 + 46 * Math.cos(ang), y = 50 + 43 * Math.sin(ang);
      const cls = [
        i === g.you ? 'me' : '', s.isTurn ? 'turn' : '', s.folded && s.inHand ? 'folded' : '',
        !s.inHand ? 'out' : '', s.winner && showdown ? 'winner' : '', s.left ? 'left' : '',
        y < 50 ? 'top' : 'bottom',
      ].join(' ');
      const cards = s.cards.map((c, k) => Cards.html(c, `p${g.handId}-${s.name}-${k}`, showdown && winSet.has(c) ? 'win' : '')).join('');
      seatsHTML += `<div class="seat ${cls}" style="left:${x}%;top:${y}%">
        <div class="seat-cards">${cards}</div>
        <div class="seat-box">
          ${avatarHTML(s.name)}
          <div class="seat-info"><b>${esc(s.name)}</b><span class="seat-chips"><span class="chip-ico sm"></span>${fmt(s.chips)}</span></div>
          ${s.isDealer ? '<span class="dealer-btn">D</span>' : ''}
          ${s.isTurn && g.deadline ? `<div class="timer-bar" data-deadline="${g.deadline}" data-total="${g.turnMs}"></div>` : ''}
        </div>
        ${s.last ? `<div class="seat-action ${s.last === 'Fold' ? 'fold' : s.last === 'All-in' ? 'allin' : ''}">${esc(s.last)}</div>` : ''}
        ${s.handName ? `<div class="hand-name ${s.winner ? 'win' : ''}">${esc(s.handName)}</div>` : ''}
      </div>`;
      if (s.bet > 0) {
        const bx = x + (50 - x) * 0.42, by = y + (50 - y) * 0.42;
        betsHTML += `<div class="bet" style="left:${bx}%;top:${by}%">${this.chipStack(s.bet)}<span>${fmt(s.bet)}</span></div>`;
      }
    });

    const board = [0, 1, 2, 3, 4].map((k) => g.board[k]
      ? Cards.html(g.board[k], `b${g.handId}-${k}`, showdown && winSet.has(g.board[k]) ? 'win' : '')
      : '<div class="card slot"></div>').join('');

    let centerMsg = '';
    if (g.phase === 'waiting') {
      const c = g.seats.filter((s) => !s.left).length;
      centerMsg = c < g.min
        ? `Esperando jugadores… <b>${c}/${g.min}</b> mínimo`
        : st.host === App.me.name ? 'Pulsa <b>Empezar partida</b> cuando estéis todos' : `Esperando a que <b>${esc(st.host)}</b> empiece la partida`;
    } else if (showdown && g.result) {
      centerMsg = g.result.winners.map((w) => `<b>${esc(w.name)}</b> gana ${fmt(w.amount)}${w.hand ? ' con <em>' + esc(w.hand) + '</em>' : ''}`).join('<br>');
    }

    $('#table-wrap').innerHTML = `
      <div class="poker-table">
        <div class="felt">
          <div class="felt-logo">♠ ROYAL CASINO ♠</div>
          <div class="deck" id="deck"></div>
          <div class="center">
            <div class="board">${board}</div>
            <div class="pot ${g.potTotal ? '' : 'hidden'}">${this.chipStack(g.pot || g.potTotal)}<span>Bote: <b>${fmt(g.potTotal)}</b></span></div>
            ${centerMsg ? `<div class="center-msg ${showdown ? 'win' : ''}">${centerMsg}</div>` : ''}
          </div>
        </div>
        ${seatsHTML}${betsHTML}
      </div>`;
    Cards.animate($('#table-wrap'), $('#deck'));

    // Controles del anfitrión
    const canStart = g.phase === 'waiting' && st.host === App.me.name;
    $('#room-controls').innerHTML = canStart
      ? `<button class="btn gold" id="start-btn" ${g.seats.filter((s) => !s.left).length < g.min ? 'disabled' : ''}>Empezar partida</button>` : '';
    const sb = $('#start-btn');
    if (sb) sb.onclick = () => App.socket.emit('room:start', (r) => r.error && toast(r.error));

    this.renderActions(g);
  },

  chipStack(amount) {
    const colors = [[1000, 'c-gold'], [500, 'c-purple'], [100, 'c-black'], [25, 'c-green'], [5, 'c-red'], [1, 'c-white']];
    let left = amount, out = '', count = 0;
    for (const [v, c] of colors) {
      while (left >= v && count < 6) { out += `<i class="pchip ${c}" style="--n:${count}"></i>`; left -= v; count++; }
    }
    return `<span class="pstack">${out}</span>`;
  },

  renderActions(g) {
    const bar = $('#action-bar');
    const my = g.my;
    const key = [g.handId, g.phase, !!my, g.currentBet, my && my.minRaiseTo, my && my.maxRaiseTo, g.pot].join('|');
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;

    if (!my) {
      const turn = g.seats.find((s) => s.isTurn);
      const meSeat = g.seats[g.you];
      let msg = '';
      if (g.phase === 'waiting') msg = 'La partida aún no ha empezado';
      else if (g.phase === 'showdown') msg = 'Siguiente mano en unos segundos…';
      else if (meSeat && !meSeat.inHand) msg = 'Entrarás en la siguiente mano';
      else if (meSeat && meSeat.folded) msg = 'Te has retirado de esta mano';
      else if (turn) msg = `Turno de <b>${esc(turn.name)}</b>…`;
      else msg = 'Repartiendo…';
      bar.innerHTML = `<div class="ab-msg">${msg}</div>`;
      return;
    }

    Sound.play('turn');
    const pot = g.potTotal;
    const presets = [
      ['Mín', my.minRaiseTo],
      ['½ Bote', g.currentBet + Math.floor(pot / 2)],
      ['Bote', g.currentBet + pot],
    ].map(([l, v]) => [l, Math.max(my.minRaiseTo, Math.min(my.maxRaiseTo, v))]);

    bar.innerHTML = `
      <div class="ab-row">
        <button class="btn danger" data-a="fold">Retirarse</button>
        ${my.canCheck
          ? '<button class="btn ghost" data-a="check">Pasar</button>'
          : `<button class="btn blue" data-a="call">Igualar ${fmt(my.toCall)}</button>`}
        ${my.canRaise ? `
        <div class="raise-box">
          <div class="presets">${presets.map(([l, v]) => `<button class="mini" data-v="${v}">${l}</button>`).join('')}<button class="mini" data-v="${my.maxRaiseTo}">All-in</button></div>
          <div class="raise-line">
            <input type="range" id="raise-range" min="${my.minRaiseTo}" max="${my.maxRaiseTo}" step="10" value="${my.minRaiseTo}">
            <input type="number" id="raise-num" min="${my.minRaiseTo}" max="${my.maxRaiseTo}" value="${my.minRaiseTo}">
          </div>
        </div>
        <button class="btn gold" data-a="raise">${g.currentBet ? 'Subir' : 'Apostar'}</button>` : ''}
      </div>`;

    const range = $('#raise-range'), num = $('#raise-num');
    if (range) {
      range.oninput = () => { num.value = range.value; };
      num.oninput = () => { range.value = num.value; };
      $$('.presets .mini', bar).forEach((b) => b.onclick = () => { range.value = num.value = b.dataset.v; });
    }
    $$('[data-a]', bar).forEach((b) => b.onclick = () => {
      const type = b.dataset.a;
      if (type === 'raise') {
        const v = +num.value;
        Sound.play('chip');
        act('act', { type: v >= my.maxRaiseTo ? 'allin' : 'raise', amount: v });
      } else {
        if (type === 'call') Sound.play('chip');
        act('act', { type });
      }
    });
  },
};
