// Ruleta europea (un solo cero). El número se decide en el servidor.
const crypto = require('crypto');

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// Lo que se devuelve por cada ficha ganadora (incluye la apuesta)
const MULT = { n: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2, dozen: 3, col: 3 };

function wins(b, n) {
  switch (b.t) {
    case 'n': return n === b.v;
    case 'red': return REDS.has(n);
    case 'black': return n > 0 && !REDS.has(n);
    case 'even': return n > 0 && n % 2 === 0;
    case 'odd': return n % 2 === 1;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19;
    case 'dozen': return n > 0 && Math.ceil(n / 12) === b.v;
    case 'col': return n > 0 && ((n - 1) % 3) + 1 === b.v;
  }
  return false;
}

function play(bets, chips) {
  if (!Array.isArray(bets) || !bets.length) return { error: 'Pon alguna ficha en el tablero' };
  if (bets.length > 160) return { error: 'Demasiadas apuestas' };
  const clean = [];
  for (const raw of bets) {
    const b = { t: String(raw && raw.t), v: raw && raw.v != null ? Number(raw.v) : null, a: Math.floor(Number(raw && raw.a)) };
    if (!MULT[b.t] || !Number.isFinite(b.a) || b.a < 1) return { error: 'Apuesta no válida' };
    if (b.t === 'n' && !(Number.isInteger(b.v) && b.v >= 0 && b.v <= 36)) return { error: 'Apuesta no válida' };
    if ((b.t === 'dozen' || b.t === 'col') && ![1, 2, 3].includes(b.v)) return { error: 'Apuesta no válida' };
    clean.push(b);
  }
  const total = clean.reduce((a, b) => a + b.a, 0);
  if (total > chips) return { error: 'No tienes suficientes fichas' };
  const number = crypto.randomInt(37);
  const payout = clean.reduce((a, b) => a + (wins(b, number) ? b.a * MULT[b.t] : 0), 0);
  return { number, total, payout };
}

module.exports = { play };
