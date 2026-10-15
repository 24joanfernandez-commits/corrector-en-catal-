// ================= Interfaz del blackjack =================
const BlackjackUI = {
  roundId: null,

  render(st) {
    const g = st.game;
    if (g.roundId !== this.roundId) { Cards.reset(); this.roundId = g.roundId; }
    const n = g.seats.length;
    const statusLabel = { bust: 'SE PASA', blackjack: 'BLACKJACK', stand: '' };
    const outcomeLabel = { win: 'GANA', blackjack: 'BLACKJACK', push: 'EMPATE', lose: 'PIERDE' };

    const seatsHTML = g.seats.map((s, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const th = Math.PI * (0.14 + 0.72 * t);
      // y = posición del borde inferior del asiento (crece hacia arriba, nunca se sale del tapete)
      const x = 50 + 40 * Math.cos(th), y = 50 + 43 * Math.sin(th);
      const cards = s.hand.map((c, k) => Cards.html(c, `bj${g.roundId}-${s.name}-${k}`)).join('');
      const res = s.result ? `<div class="bj-result ${s.result.outcome}">${outcomeLabel[s.result.outcome]}${s.result.net ? ` ${s.result.net > 0 ? '+' : ''}${fmt(s.result.net)}` : ''}</div>` : '';
      const status = s.status && statusLabel[s.status] ? `<div class="bj-status ${s.status}">${statusLabel[s.status]}</div>` : '';
      return `<div class="bj-seat ${i === g.you ? 'me' : ''} ${s.isTurn ? 'turn' : ''} ${s.left ? 'left' : ''}" style="left:${x}%;top:${y}%">
        <div class="bj-hand">
          <div class="bj-cards">${cards}</div>
          ${s.value ? `<div class="bj-value ${s.status === 'bust' ? 'bust' : ''}">${s.soft && s.value < 21 ? s.value - 10 + '/' : ''}${s.value}</div>` : ''}
          <div class="bj-badges">${status}${res}</div>
        </div>
        <div class="bj-spot ${s.bet ? 'has' : ''}">
          ${s.bet ? chipTower(s.bet) : ''}
          ${s.bet ? `<span class="bj-amount">${fmt(s.bet)}</span>` : ''}
          ${s.ready && g.phase === 'betting' ? '<em class="ready">✓ Listo</em>' : ''}
        </div>
        <div class="seat-box">
          <span class="seat-stack">${chipTower(s.chips, 'sm', 3, true)}</span>
          ${avatarHTML(s.name)}
          <div class="seat-info"><b>${nameHTML(s.name)}</b><span class="seat-chips"><span class="chip-ico sm"></span>${fmt(s.chips)}</span></div>
          ${s.isTurn && g.deadline ? `<div class="timer-bar" data-deadline="${g.deadline}" data-total="${g.turnMs}"></div>` : ''}
        </div>
      </div>`;
    }).join('');

    const dealerCards = g.dealer.cards.map((c, k) => Cards.html(c, `bjd${g.roundId}-${k}`)).join('');
    let msg = '';
    if (g.phase === 'betting') {
      msg = g.deadline
        ? `Apuestas abiertas · reparto en <b data-deadline="${g.deadline}" data-total="${g.turnMs}"></b> s`
        : 'Haz tu apuesta para empezar la ronda';
    } else if (g.phase === 'dealer') msg = 'Juega la banca…';

    $('#table-wrap').innerHTML = `
      <div class="bj-table">
        <div class="bj-felt">
          <div class="deck bj-deck" id="deck"></div>
          <div class="bj-dealer">
            <div class="bj-dealer-label">BANCA</div>
            <div class="bj-cards dealer">${dealerCards}</div>
            ${g.dealer.value ? `<div class="bj-value ${g.dealer.value > 21 ? 'bust' : ''}">${g.dealer.value}</div>` : ''}
            ${msg ? `<div class="bj-msg">${msg}</div>` : ''}
          </div>
          <div class="bj-arc-text">BLACKJACK PAGA 3 A 2 · LA BANCA SE PLANTA EN 17</div>
        </div>
        ${seatsHTML}
      </div>`;
    fitTable();
    Cards.animate($('#table-wrap'), $('#deck'));
    $('#room-controls').innerHTML = '';
    this.renderActions(g);
  },

  renderActions(g) {
    const bar = $('#action-bar');
    const me = g.seats[g.you];
    const key = [g.phase, g.roundId, !!g.my, me && me.bet, me && me.ready, g.my && g.my.canDouble, me && me.hand.length, App.me.chips].join('|');
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    if (!me) { bar.innerHTML = ''; return; }

    if (g.phase === 'betting') {
      const chips = [10, 25, 50, 100, 500];
      bar.innerHTML = `
        <div class="ab-row">
          <div class="bet-chips">${chips.map((v) => `<button class="bchip v${v}" data-bet="${v}" ${v > App.me.chips ? 'disabled' : ''}>${v}</button>`).join('')}</div>
          <div class="ab-bet">Tu apuesta: <b>${fmt(me.bet)}</b></div>
          <button class="btn ghost" data-a="clear" ${me.bet ? '' : 'disabled'}>Borrar</button>
          <button class="btn gold" data-a="ready" ${me.bet && !me.ready ? '' : 'disabled'}>${me.ready ? 'Esperando…' : '¡Repartir!'}</button>
        </div>`;
      $$('[data-bet]', bar).forEach((b) => b.onclick = () => { Sound.play('chip'); act('bet', { amount: +b.dataset.bet }); });
    } else if (g.my) {
      Sound.play('turn');
      bar.innerHTML = `
        <div class="ab-row">
          <button class="btn blue big" data-a="hit">Pedir carta</button>
          <button class="btn ghost big" data-a="stand">Plantarse</button>
          <button class="btn gold big" data-a="double" ${g.my.canDouble ? '' : 'disabled'}>Doblar</button>
        </div>`;
    } else {
      const turn = g.seats.find((s) => s.isTurn);
      let msg = 'Ronda en juego…';
      if (!me.inRound && g.phase !== 'results') msg = 'Jugarás en la siguiente ronda';
      else if (turn) msg = `Turno de <b>${esc(turn.name)}</b>…`;
      else if (g.phase === 'dealer') msg = 'Juega la banca…';
      else if (g.phase === 'results') msg = 'Nueva ronda en unos segundos…';
      bar.innerHTML = `<div class="ab-msg">${msg}</div>`;
    }
    $$('[data-a]', bar).forEach((b) => b.onclick = () => act(b.dataset.a));
  },
};
