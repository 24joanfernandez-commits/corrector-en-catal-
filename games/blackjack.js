// Blackjack: hasta 7 jugadores contra la banca. Paga 3:2, la banca se planta en 17.
const { newDeck, shuffle } = require('./cards');

const BET_MS = 15000;
const TURN_MS = 20000;
const RESULT_MS = 6000;
const MIN_BET = 10;

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c === 'XX') continue;
    const r = c[0];
    if (r === 'A') { aces++; total += 11; }
    else if ('TJQK'.includes(r)) total += 10;
    else total += +r;
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

class BlackjackGame {
  constructor(ctx, { max }) {
    this.ctx = ctx;
    this.type = 'blackjack';
    this.max = max;
    this.min = 1;
    this.seats = [];
    this.phase = 'betting'; // betting | playing | dealer | results
    this.dealer = [];
    this.deck = [];
    this.turn = -1;
    this.deadline = 0;
    this.timer = null;
    this.roundId = 0;
  }

  get playerCount() { return this.seats.filter((s) => !s.left).length; }
  get status() { return this.phase === 'betting' ? 'Apuestas' : 'Jugando'; }

  addPlayer(name) {
    const ex = this.seats.find((s) => s.name === name);
    if (ex) { ex.left = false; return null; }
    if (this.playerCount >= this.max) return 'La mesa está llena';
    this.seats.push({ name, bet: 0, hand: [], status: '', result: null, inRound: false, left: false });
    return null;
  }

  removePlayer(name) {
    const i = this.seats.findIndex((s) => s.name === name);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.phase === 'betting') {
      if (s.bet) this.ctx.addChips(name, s.bet);
      this.seats.splice(i, 1);
      if (this.seats.every((x) => !x.bet)) { clearTimeout(this.timer); this.deadline = 0; }
      else this.checkAllBet();
    } else {
      s.left = true;
      if (this.phase === 'playing' && this.turn === i) { s.status = 'stand'; this.nextTurn(); }
    }
    if (!this.seats.length) { clearTimeout(this.timer); this.reset(true); }
    this.ctx.update();
  }

  destroy() { clearTimeout(this.timer); }

  handle(name, action, data = {}) {
    const i = this.seats.findIndex((s) => s.name === name && !s.left);
    if (i < 0) return 'No estás en la mesa';
    const s = this.seats[i];

    if (action === 'bet') {
      if (this.phase !== 'betting') return 'Espera a la siguiente ronda';
      const amount = Math.floor(Number(data.amount));
      if (!Number.isFinite(amount) || amount <= 0) return 'Cantidad no válida';
      if (amount > this.ctx.getChips(name)) return 'No tienes suficientes fichas';
      if (s.bet + amount < MIN_BET) return `La apuesta mínima es ${MIN_BET}`;
      this.ctx.addChips(name, -amount);
      s.bet += amount;
      if (!this.deadline) {
        this.deadline = Date.now() + BET_MS;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.deal(), BET_MS);
      }
      this.checkAllBet();
      this.ctx.update();
      return null;
    }
    if (action === 'clear') {
      if (this.phase !== 'betting') return 'Ya no puedes quitar la apuesta';
      this.ctx.addChips(name, s.bet);
      s.bet = 0;
      this.ctx.update();
      return null;
    }
    if (action === 'ready') {
      if (this.phase !== 'betting' || !s.bet) return 'Primero haz una apuesta';
      s.ready = true;
      this.checkAllBet();
      this.ctx.update();
      return null;
    }

    if (this.phase !== 'playing' || this.turn !== i) return 'No es tu turno';
    if (action === 'hit') {
      s.hand.push(this.draw());
      const v = handValue(s.hand).total;
      if (v > 21) s.status = 'bust';
      else if (v === 21) s.status = 'stand';
      if (s.status) this.nextTurn(); else { this.setTurnTimer(); this.ctx.update(); }
      return null;
    }
    if (action === 'stand') { s.status = 'stand'; this.nextTurn(); return null; }
    if (action === 'double') {
      if (s.hand.length !== 2) return 'Solo puedes doblar con 2 cartas';
      if (this.ctx.getChips(name) < s.bet) return 'No tienes fichas para doblar';
      this.ctx.addChips(name, -s.bet);
      s.bet *= 2;
      s.doubled = true;
      s.hand.push(this.draw());
      s.status = handValue(s.hand).total > 21 ? 'bust' : 'stand';
      this.nextTurn();
      return null;
    }
    return 'Acción no válida';
  }

  // Si todos los que pueden apostar ya están listos, se reparte enseguida
  checkAllBet() {
    const active = this.seats.filter((s) => !s.left);
    const canBet = active.filter((s) => s.bet > 0 || this.ctx.getChips(s.name) >= MIN_BET);
    const bettors = active.filter((s) => s.bet > 0);
    if (!bettors.length) return;
    const allIn = canBet.every((s) => s.bet > 0 && s.ready);
    if (allIn) {
      clearTimeout(this.timer);
      this.deadline = Date.now() + 1200;
      this.timer = setTimeout(() => this.deal(), 1200);
    }
  }

  draw() {
    if (this.deck.length < 15) this.deck = shuffle(newDeck(6));
    return this.deck.pop();
  }

  deal() {
    clearTimeout(this.timer);
    const players = this.seats.filter((s) => s.bet > 0 && !s.left);
    if (!players.length) { this.deadline = 0; this.ctx.update(); return; }
    if (this.deck.length < 80) this.deck = shuffle(newDeck(6));
    this.roundId++;
    this.phase = 'playing';
    this.dealer = [];
    for (const s of this.seats) Object.assign(s, { inRound: s.bet > 0 && !s.left, hand: [], status: '', result: null, doubled: false, ready: false });
    for (let r = 0; r < 2; r++) {
      for (const s of this.seats) if (s.inRound) s.hand.push(this.draw());
      this.dealer.push(this.draw());
    }
    for (const s of this.seats) if (s.inRound && handValue(s.hand).total === 21) s.status = 'blackjack';
    if (handValue(this.dealer).total === 21) {
      this.phase = 'dealer';
      this.turn = -1;
      this.ctx.update();
      this.timer = setTimeout(() => this.settle(), 1500);
      return;
    }
    this.turn = -1;
    this.nextTurn();
  }

  setTurnTimer() {
    clearTimeout(this.timer);
    this.deadline = Date.now() + TURN_MS;
    const turn = this.turn, round = this.roundId;
    this.timer = setTimeout(() => {
      if (this.turn !== turn || this.roundId !== round || this.phase !== 'playing') return;
      this.seats[turn].status = 'stand';
      this.nextTurn();
    }, TURN_MS);
  }

  nextTurn() {
    clearTimeout(this.timer);
    this.turn = this.seats.findIndex((s, i) => i > this.turn && s.inRound && !s.status && !s.left);
    if (this.turn === -1) return this.dealerPlay();
    this.setTurnTimer();
    this.ctx.update();
  }

  dealerPlay() {
    this.phase = 'dealer';
    this.turn = -1;
    this.deadline = 0;
    this.ctx.update();
    const needs = this.seats.some((s) => s.inRound && s.status === 'stand');
    const step = () => {
      if (needs && handValue(this.dealer).total < 17) {
        this.dealer.push(this.draw());
        this.ctx.update();
        this.timer = setTimeout(step, 850);
      } else {
        this.timer = setTimeout(() => this.settle(), 600);
      }
    };
    this.timer = setTimeout(step, 900);
  }

  settle() {
    const dv = handValue(this.dealer).total;
    const dealerBJ = this.dealer.length === 2 && dv === 21;
    for (const s of this.seats) {
      if (!s.inRound) continue;
      const pv = handValue(s.hand).total;
      let outcome;
      if (s.status === 'bust') outcome = 'lose';
      else if (s.status === 'blackjack') outcome = dealerBJ ? 'push' : 'blackjack';
      else if (dealerBJ) outcome = 'lose';
      else if (dv > 21 || pv > dv) outcome = 'win';
      else if (pv === dv) outcome = 'push';
      else outcome = 'lose';
      const payout = outcome === 'blackjack' ? Math.floor(s.bet * 2.5) : outcome === 'win' ? s.bet * 2 : outcome === 'push' ? s.bet : 0;
      if (payout) this.ctx.addChips(s.name, payout);
      s.result = { outcome, net: payout - s.bet };
      if (s.left) continue;
      if (outcome === 'win' || outcome === 'blackjack') this.ctx.event(s.name, 'victory', { amount: payout - s.bet, label: outcome === 'blackjack' ? 'BLACKJACK!' : null, delay: 200 });
      else if (outcome === 'push') this.ctx.event(s.name, 'push', { amount: 0, delay: 200 });
      else this.ctx.event(s.name, 'defeat', { amount: -s.bet, delay: 200 });
    }
    this.phase = 'results';
    this.turn = -1;
    this.deadline = Date.now() + RESULT_MS;
    this.ctx.update();
    this.timer = setTimeout(() => { this.reset(); this.ctx.update(); }, RESULT_MS);
  }

  reset() {
    clearTimeout(this.timer);
    this.seats = this.seats.filter((s) => !s.left);
    for (const s of this.seats) Object.assign(s, { bet: 0, hand: [], status: '', result: null, inRound: false, doubled: false, ready: false });
    this.dealer = [];
    this.phase = 'betting';
    this.turn = -1;
    this.deadline = 0;
  }

  stateFor(name) {
    const hideHole = this.phase === 'playing';
    const dealerCards = hideHole ? [this.dealer[0], 'XX'] : this.dealer;
    const you = this.seats.findIndex((s) => s.name === name);
    const st = {
      type: 'blackjack',
      phase: this.phase,
      roundId: this.roundId,
      deadline: this.deadline,
      turnMs: this.phase === 'betting' ? BET_MS : this.phase === 'results' ? RESULT_MS : TURN_MS,
      minBet: MIN_BET,
      dealer: { cards: dealerCards, value: this.dealer.length ? handValue(dealerCards).total : 0 },
      seats: this.seats.map((s, i) => ({
        name: s.name,
        chips: this.ctx.getChips(s.name),
        bet: s.bet,
        hand: s.hand,
        value: s.hand.length ? handValue(s.hand).total : 0,
        soft: s.hand.length ? handValue(s.hand).soft : false,
        status: s.status,
        result: s.result,
        inRound: s.inRound,
        ready: !!s.ready,
        left: s.left,
        isTurn: i === this.turn,
      })),
      you,
    };
    if (you >= 0 && you === this.turn) {
      const s = this.seats[you];
      st.my = { canDouble: s.hand.length === 2 && this.ctx.getChips(name) >= s.bet };
    }
    return st;
  }
}

module.exports = { BlackjackGame, handValue };
