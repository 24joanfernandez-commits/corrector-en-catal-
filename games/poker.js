// Texas Hold'em No-Limit
const { newDeck, shuffle } = require('./cards');
const { bestHand, compare } = require('./evaluator');

const SB = 10;
const BB = 20;
const TURN_MS = 25000;
const SHOWDOWN_MS = 7000;
const RUNOUT_MS = 1400;
const BETTING = ['preflop', 'flop', 'turn', 'river'];

class PokerGame {
  constructor(ctx, { max }) {
    this.ctx = ctx; // { getChips, addChips, update, event }
    this.type = 'poker';
    this.max = max;
    this.min = 3;
    this.seats = [];
    this.phase = 'waiting';
    this.started = false;
    this.dealer = -1;
    this.board = [];
    this.deck = [];
    this.turn = -1;
    this.currentBet = 0;
    this.minRaise = BB;
    this.handId = 0;
    this.deadline = 0;
    this.timer = null;
    this.result = null;
  }

  // ---------- jugadores ----------
  get playerCount() { return this.seats.filter((s) => !s.left).length; }
  get status() { return this.started ? 'Jugando' : 'Esperando'; }
  inProgress() { return BETTING.includes(this.phase); }

  addPlayer(name) {
    const ex = this.seats.find((s) => s.name === name);
    if (ex) { ex.left = false; return null; }
    if (this.playerCount >= this.max) return 'La mesa está llena';
    this.seats.push({ name, hole: [], bet: 0, total: 0, folded: true, allIn: false, acted: false, inHand: false, left: false, last: '' });
    return null;
  }

  removePlayer(name) {
    const i = this.seats.findIndex((s) => s.name === name);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.inProgress() && s.inHand) {
      // Se queda la silla hasta que acabe la mano (sus fichas siguen en el bote)
      s.left = true;
      if (!s.folded) {
        s.folded = true;
        s.last = 'Fold';
        if (this.turn === i) {
          clearTimeout(this.timer);
          this.afterAction();
        } else {
          const live = this.seats.filter((x) => x.inHand && !x.folded);
          if (live.length === 1) this.winUncontested(live[0]);
        }
      }
    } else {
      this.seats.splice(i, 1);
      if (i <= this.dealer) this.dealer--;
    }
    if (this.started && this.playerCount < 2 && !this.inProgress()) this.stop();
    this.ctx.update();
  }

  stop() {
    clearTimeout(this.timer);
    this.started = false;
    this.phase = 'waiting';
    this.turn = -1;
  }

  destroy() { clearTimeout(this.timer); }

  start() {
    if (this.started) return 'La partida ya ha empezado';
    if (this.playerCount < this.min) return `Se necesitan al menos ${this.min} jugadores`;
    const withChips = this.seats.filter((s) => !s.left && this.ctx.getChips(s.name) > 0).length;
    if (withChips < 2) return 'No hay suficientes jugadores con fichas';
    this.started = true;
    this.startHand();
    return null;
  }

  handle(name, action, data = {}) {
    if (action === 'act') return this.act(name, data.type, data.amount);
    return 'Acción desconocida';
  }

  // ---------- flujo de la mano ----------
  nextIdx(from, pred) {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const j = (((from + k) % n) + n) % n;
      if (pred(this.seats[j])) return j;
    }
    return -1;
  }

  canAct(s) { return s.inHand && !s.folded && !s.allIn; }
  needsAction(s) { return this.canAct(s) && (!s.acted || s.bet < this.currentBet); }

  post(i, amount) {
    const s = this.seats[i];
    const a = Math.max(0, Math.min(amount, this.ctx.getChips(s.name)));
    this.ctx.addChips(s.name, -a);
    s.bet += a;
    s.total += a;
    if (this.ctx.getChips(s.name) === 0) s.allIn = true;
    return a;
  }

  startHand() {
    clearTimeout(this.timer);
    this.seats = this.seats.filter((s) => !s.left);
    if (this.dealer >= this.seats.length) this.dealer = this.seats.length - 1;
    const eligible = this.seats.filter((s) => this.ctx.getChips(s.name) > 0);
    if (!this.started || eligible.length < 2) {
      this.stop();
      this.result = null;
      this.ctx.update();
      return;
    }
    this.handId++;
    this.deck = shuffle(newDeck());
    this.board = [];
    this.result = null;
    this.minRaise = BB;
    for (const s of this.seats) {
      const has = this.ctx.getChips(s.name) > 0;
      Object.assign(s, { hole: [], bet: 0, total: 0, acted: false, allIn: false, last: '', inHand: has, folded: !has });
    }
    this.dealer = this.nextIdx(this.dealer, (s) => s.inHand);
    const sb = eligible.length === 2 ? this.dealer : this.nextIdx(this.dealer, (s) => s.inHand);
    const bb = this.nextIdx(sb, (s) => s.inHand);
    this.post(sb, SB); this.seats[sb].last = 'Ciega peq.';
    this.post(bb, BB); this.seats[bb].last = 'Ciega gr.';
    this.currentBet = BB;
    for (let r = 0; r < 2; r++) {
      let i = sb;
      do {
        if (this.seats[i].inHand) this.seats[i].hole.push(this.deck.pop());
        i = (i + 1) % this.seats.length;
      } while (i !== sb);
    }
    this.phase = 'preflop';
    this.turn = bb;
    this.afterAction(false);
  }

  setTurnTimer() {
    clearTimeout(this.timer);
    this.deadline = Date.now() + TURN_MS;
    const handId = this.handId;
    const turn = this.turn;
    this.timer = setTimeout(() => {
      if (this.handId !== handId || this.turn !== turn) return;
      const s = this.seats[turn];
      this.act(s.name, this.currentBet > s.bet ? 'fold' : 'check');
    }, TURN_MS);
  }

  afterAction() {
    const live = this.seats.filter((s) => s.inHand && !s.folded);
    if (live.length === 1) return this.winUncontested(live[0]);
    const actors = this.seats.filter((s) => this.canAct(s));
    const pending = actors.filter((s) => this.needsAction(s));
    const done = actors.length === 0 || pending.length === 0 ||
      (actors.length === 1 && actors[0].bet >= this.currentBet);
    if (done) return this.endStreet();
    this.turn = this.nextIdx(this.turn, (s) => this.needsAction(s));
    this.setTurnTimer();
    this.ctx.update();
  }

  endStreet() {
    clearTimeout(this.timer);
    for (const s of this.seats) {
      s.bet = 0;
      s.acted = false;
      if (s.inHand && !s.folded && !s.allIn) s.last = '';
    }
    this.currentBet = 0;
    this.minRaise = BB;
    if (this.phase === 'river') return this.showdown();
    this.deck.pop(); // quemar carta
    if (this.phase === 'preflop') { this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop()); this.phase = 'flop'; }
    else if (this.phase === 'flop') { this.board.push(this.deck.pop()); this.phase = 'turn'; }
    else if (this.phase === 'turn') { this.board.push(this.deck.pop()); this.phase = 'river'; }

    const actors = this.seats.filter((s) => this.canAct(s));
    if (actors.length <= 1) {
      // Todos all-in: se reparten el resto de cartas con pausa para la animación
      this.turn = -1;
      this.deadline = 0;
      this.ctx.update();
      const handId = this.handId;
      this.timer = setTimeout(() => { if (this.handId === handId) this.endStreet(); }, RUNOUT_MS);
      return;
    }
    this.turn = this.dealer;
    this.afterAction();
  }

  act(name, type, amount) {
    const i = this.seats.findIndex((s) => s.name === name);
    if (!this.inProgress() || i < 0 || i !== this.turn) return 'No es tu turno';
    const s = this.seats[i];
    const chips = this.ctx.getChips(name);
    const toCall = this.currentBet - s.bet;

    switch (type) {
      case 'fold':
        s.folded = true;
        s.last = 'Fold';
        break;
      case 'check':
        if (toCall > 0) return 'No puedes pasar, hay una apuesta';
        s.last = 'Pasa';
        break;
      case 'call': {
        if (toCall <= 0) { s.last = 'Pasa'; break; }
        const paid = this.post(i, toCall);
        s.last = s.allIn ? 'All-in' : `Iguala ${paid}`;
        break;
      }
      case 'raise':
      case 'allin': {
        const maxTarget = s.bet + chips;
        let target = type === 'allin' ? maxTarget : Math.floor(Number(amount));
        if (!Number.isFinite(target) || target <= 0) return 'Cantidad no válida';
        target = Math.min(target, maxTarget);
        if (target <= this.currentBet) {
          if (type !== 'allin') return 'La subida tiene que ser mayor que la apuesta actual';
          this.post(i, target - s.bet);
          s.last = 'All-in';
          break;
        }
        const minTarget = this.currentBet + this.minRaise;
        if (target < minTarget && target < maxTarget) return `La subida mínima es a ${minTarget}`;
        const wasOpen = this.currentBet === 0;
        if (target - this.currentBet >= this.minRaise) this.minRaise = target - this.currentBet;
        this.post(i, target - s.bet);
        this.currentBet = target;
        for (const o of this.seats) if (o !== s) o.acted = false;
        s.last = s.allIn ? 'All-in' : `${wasOpen ? 'Apuesta' : 'Sube a'} ${target}`;
        break;
      }
      default:
        return 'Acción no válida';
    }
    s.acted = true;
    clearTimeout(this.timer);
    this.afterAction();
    return null;
  }

  potTotal() { return this.seats.reduce((a, s) => a + s.total, 0); }

  winUncontested(winner) {
    const pot = this.potTotal();
    this.ctx.addChips(winner.name, pot);
    this.result = { uncontested: true, winners: [{ name: winner.name, amount: pot, hand: null }], shown: [], hands: {}, winCards: [] };
    this.finishHand({ [winner.name]: pot });
  }

  showdown() {
    const live = this.seats.filter((s) => s.inHand && !s.folded);
    for (const s of live) s.best = bestHand([...s.hole, ...this.board]);
    const contributors = this.seats.filter((s) => s.total > 0);
    const levels = [...new Set(live.map((s) => s.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      const amt = contributors.reduce((a, s) => a + Math.min(s.total, L) - Math.min(s.total, prev), 0);
      pots.push({ amt, eligible: live.filter((s) => s.total >= L) });
      prev = L;
    }
    const leftover = this.potTotal() - pots.reduce((a, p) => a + p.amt, 0);
    if (leftover > 0 && pots.length) pots[pots.length - 1].amt += leftover;

    const won = {};
    let winCards = [];
    pots.forEach((pot, idx) => {
      if (pot.amt <= 0) return;
      let best = null;
      for (const s of pot.eligible) if (!best || compare(s.best.score, best) > 0) best = s.best.score;
      const winners = pot.eligible.filter((s) => compare(s.best.score, best) === 0);
      const share = Math.floor(pot.amt / winners.length);
      winners.forEach((w, k) => { won[w.name] = (won[w.name] || 0) + share + (k === 0 ? pot.amt - share * winners.length : 0); });
      if (idx === 0) winCards = winners[0].best.cards;
    });
    for (const [n, amt] of Object.entries(won)) this.ctx.addChips(n, amt);
    const hands = {};
    for (const s of live) hands[s.name] = s.best.name;
    this.result = {
      uncontested: false,
      winners: Object.entries(won).map(([n, amount]) => ({ name: n, amount, hand: hands[n] })),
      shown: live.map((s) => s.name),
      hands,
      winCards,
    };
    this.finishHand(won);
  }

  finishHand(won) {
    clearTimeout(this.timer);
    this.phase = 'showdown';
    this.turn = -1;
    this.deadline = 0;
    for (const s of this.seats) {
      if (!s.inHand || s.left) continue;
      const w = won[s.name] || 0;
      const net = w - s.total;
      if (net > 0) this.ctx.event(s.name, 'victory', { amount: net, delay: this.result.uncontested ? 300 : 1600 });
      else if (w > 0) this.ctx.event(s.name, 'push', { amount: w, delay: 1600 });
      else if (s.total > 0) this.ctx.event(s.name, 'defeat', { amount: -s.total, delay: this.result.uncontested ? 300 : 1600 });
    }
    this.ctx.update();
    const handId = this.handId;
    this.timer = setTimeout(() => { if (this.handId === handId) this.startHand(); }, SHOWDOWN_MS);
  }

  // ---------- estado visible para cada jugador ----------
  stateFor(name) {
    const showAll = this.phase === 'showdown' && this.result && !this.result.uncontested;
    const you = this.seats.findIndex((s) => s.name === name);
    const seats = this.seats.map((s, i) => {
      const reveal = s.name === name || (showAll && this.result.shown.includes(s.name));
      return {
        name: s.name,
        chips: this.ctx.getChips(s.name),
        bet: s.bet,
        folded: s.folded,
        allIn: s.allIn,
        inHand: s.inHand,
        left: s.left,
        last: s.last,
        isDealer: i === this.dealer,
        isTurn: i === this.turn,
        cards: s.inHand ? (reveal ? s.hole : s.hole.map(() => 'XX')) : [],
        handName: showAll ? this.result.hands[s.name] || null : null,
        winner: !!(this.result && this.result.winners.some((w) => w.name === s.name)),
      };
    });
    const st = {
      type: 'poker',
      phase: this.phase,
      started: this.started,
      handId: this.handId,
      board: this.board,
      pot: this.potTotal() - this.seats.reduce((a, s) => a + s.bet, 0),
      potTotal: this.potTotal(),
      currentBet: this.currentBet,
      sb: SB, bb: BB,
      turnMs: TURN_MS,
      deadline: this.deadline,
      seats, you,
      min: this.min,
      result: this.result,
    };
    if (you >= 0 && you === this.turn) {
      const s = this.seats[you];
      const chips = this.ctx.getChips(name);
      st.my = {
        toCall: Math.min(this.currentBet - s.bet, chips),
        canCheck: this.currentBet <= s.bet,
        minRaiseTo: Math.min(this.currentBet + this.minRaise, s.bet + chips),
        maxRaiseTo: s.bet + chips,
        canRaise: s.bet + chips > this.currentBet,
      };
    }
    return st;
  }
}

module.exports = { PokerGame };
