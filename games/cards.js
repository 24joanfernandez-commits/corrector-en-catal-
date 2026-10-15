const crypto = require('crypto');

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

// Las cartas son strings: rango + palo, p. ej. "As" (as de picas), "Th" (10 de corazones)
function newDeck(decks = 1) {
  const d = [];
  for (let k = 0; k < decks; k++) for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rankOf = (c) => RANKS.indexOf(c[0]) + 2;

module.exports = { newDeck, shuffle, rankOf };
