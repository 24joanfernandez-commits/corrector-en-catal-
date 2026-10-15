// Apuestas de fútbol: el resultado se simula en el servidor según el nivel de cada equipo.
const crypto = require('crypto');

// rating = nivel del equipo (0-100). c1/c2 = colores de la camiseta.
const TEAMS = [
  { id: 'mci', name: 'Manchester City', short: 'MCI', rating: 92, c1: '#6cabdd', c2: '#ffffff' },
  { id: 'rma', name: 'Real Madrid', short: 'RMA', rating: 92, c1: '#ffffff', c2: '#febe10' },
  { id: 'bar', name: 'FC Barcelona', short: 'BAR', rating: 89, c1: '#a50044', c2: '#004d98' },
  { id: 'bay', name: 'Bayern Múnich', short: 'BAY', rating: 89, c1: '#dc052d', c2: '#ffffff' },
  { id: 'psg', name: 'Paris Saint-Germain', short: 'PSG', rating: 88, c1: '#004170', c2: '#da291c' },
  { id: 'liv', name: 'Liverpool', short: 'LIV', rating: 88, c1: '#c8102e', c2: '#f6eb61' },
  { id: 'ars', name: 'Arsenal', short: 'ARS', rating: 87, c1: '#ef0107', c2: '#ffffff' },
  { id: 'int', name: 'Inter de Milán', short: 'INT', rating: 86, c1: '#0068a8', c2: '#000000' },
  { id: 'lev', name: 'Bayer Leverkusen', short: 'B04', rating: 85, c1: '#e32221', c2: '#000000' },
  { id: 'che', name: 'Chelsea', short: 'CHE', rating: 84, c1: '#034694', c2: '#ffffff' },
  { id: 'atm', name: 'Atlético de Madrid', short: 'ATM', rating: 84, c1: '#cb3524', c2: '#ffffff' },
  { id: 'juv', name: 'Juventus', short: 'JUV', rating: 83, c1: '#ffffff', c2: '#000000' },
  { id: 'mil', name: 'AC Milan', short: 'MIL', rating: 83, c1: '#fb090b', c2: '#000000' },
  { id: 'mun', name: 'Manchester United', short: 'MUN', rating: 82, c1: '#da291c', c2: '#fbe122' },
  { id: 'bvb', name: 'Borussia Dortmund', short: 'BVB', rating: 82, c1: '#fde100', c2: '#000000' },
  { id: 'nap', name: 'Napoli', short: 'NAP', rating: 82, c1: '#12a0d7', c2: '#ffffff' },
  { id: 'tot', name: 'Tottenham', short: 'TOT', rating: 81, c1: '#ffffff', c2: '#132257' },
  { id: 'rso', name: 'Real Sociedad', short: 'RSO', rating: 79, c1: '#0067b1', c2: '#ffffff' },
  { id: 'vil', name: 'Villarreal', short: 'VIL', rating: 79, c1: '#ffe667', c2: '#005187' },
  { id: 'ben', name: 'Benfica', short: 'BEN', rating: 79, c1: '#e83030', c2: '#ffffff' },
  { id: 'por', name: 'FC Porto', short: 'POR', rating: 79, c1: '#00428c', c2: '#ffffff' },
  { id: 'bet', name: 'Real Betis', short: 'BET', rating: 78, c1: '#0bb363', c2: '#ffffff' },
  { id: 'gir', name: 'Girona', short: 'GIR', rating: 78, c1: '#cd2534', c2: '#ffffff' },
  { id: 'sev', name: 'Sevilla', short: 'SEV', rating: 77, c1: '#ffffff', c2: '#d4021d' },
  { id: 'ath', name: 'Athletic Club', short: 'ATH', rating: 79, c1: '#ee2523', c2: '#ffffff' },
  { id: 'aja', name: 'Ajax', short: 'AJA', rating: 77, c1: '#ffffff', c2: '#d2122e' },
  { id: 'vcf', name: 'Valencia', short: 'VCF', rating: 75, c1: '#ffffff', c2: '#ee3524' },
  { id: 'cel', name: 'Celtic', short: 'CEL', rating: 72, c1: '#018749', c2: '#ffffff' },
];
const byId = new Map(TEAMS.map((t) => [t.id, t]));

const HOME_ADV = 3;     // ventaja de jugar en casa
const MARGIN = 0.94;    // margen de la casa (como una casa de apuestas real)
const MAX_GOALS = 9;

const rnd = () => crypto.randomInt(1e9) / 1e9;

// Goles esperados de cada equipo según la diferencia de nivel
function lambdas(h, a) {
  const d = (h.rating + HOME_ADV - a.rating) / 28;
  return [1.35 * Math.exp(d), 1.35 * Math.exp(-d)];
}
function poisson(k, l) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}
function probs(h, a) {
  const [lh, la] = lambdas(h, a);
  let p1 = 0, px = 0, p2 = 0;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
    const p = poisson(i, lh) * poisson(j, la);
    if (i > j) p1 += p; else if (i === j) px += p; else p2 += p;
  }
  const s = p1 + px + p2;
  return { 1: p1 / s, X: px / s, 2: p2 / s };
}
function odds(h, a) {
  const p = probs(h, a);
  const o = {};
  for (const k of ['1', 'X', '2']) o[k] = Math.max(1.03, Math.round((MARGIN / p[k]) * 100) / 100);
  return o;
}
function samplePoisson(l) {
  const L = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return Math.min(MAX_GOALS, k - 1);
}

function info(homeId, awayId) {
  const h = byId.get(homeId), a = byId.get(awayId);
  if (!h || !a || h === a) return null;
  const p = probs(h, a);
  return { odds: odds(h, a), probs: p };
}

function fixtures(n = 6) {
  const pool = TEAMS.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [];
  for (let i = 0; i + 1 < pool.length && out.length < n; i += 2) {
    out.push({ home: pool[i].id, away: pool[i + 1].id, odds: odds(pool[i], pool[i + 1]) });
  }
  return out;
}

function play({ home, away, pick, amount }, chips) {
  const h = byId.get(String(home)), a = byId.get(String(away));
  if (!h || !a) return { error: 'Elige los dos equipos' };
  if (h === a) return { error: 'Un equipo no puede jugar contra sí mismo' };
  pick = String(pick);
  if (!['1', 'X', '2'].includes(pick)) return { error: 'Elige a quién apuestas' };
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount < 1) return { error: 'Cantidad no válida' };
  if (amount > chips) return { error: 'No tienes suficientes fichas' };

  const o = odds(h, a);
  const [lh, la] = lambdas(h, a);
  const hg = samplePoisson(lh), ag = samplePoisson(la);
  // Minutos de cada gol (distintos y ordenados)
  const used = new Set();
  const goals = [];
  const addGoal = (team) => {
    let m;
    do { m = 1 + crypto.randomInt(90); } while (used.has(m));
    used.add(m);
    goals.push({ min: m, team });
  };
  for (let i = 0; i < hg; i++) addGoal('home');
  for (let i = 0; i < ag; i++) addGoal('away');
  goals.sort((x, y) => x.min - y.min);

  const result = hg > ag ? '1' : hg === ag ? 'X' : '2';
  const payout = result === pick ? Math.floor(amount * o[pick]) : 0;
  return { home: h.id, away: a.id, pick, amount, odds: o, homeGoals: hg, awayGoals: ag, goals, result, payout };
}

module.exports = { TEAMS, info, fixtures, play };
