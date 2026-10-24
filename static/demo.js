// Offline demo data. Everything here is SYNTHETIC: a seeded generator that
// produces NBA-shaped shot charts so the UI works without stats.nba.com.
// It is shown with a "DEMO" badge and never attributed to a real player.

export const DEMO_PLAYER = { id: -1, name: "DEMO · Splash Bot (合成数据)", active: true };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// zone: [weight, make probability, action types]
const ZONES = {
  rim:    [0.24, 0.66, ["Driving Layup Shot", "Layup Shot", "Driving Finger Roll Layup Shot", "Cutting Layup Shot"]],
  paint:  [0.08, 0.47, ["Floating Jump shot", "Driving Floating Jump Shot"]],
  mid:    [0.12, 0.49, ["Pullup Jump shot", "Jump Shot", "Step Back Jump shot"]],
  corner: [0.08, 0.45, ["Jump Shot"]],
  above:  [0.44, 0.43, ["Jump Shot", "Pullup Jump shot", "Step Back Jump shot"]],
  deep:   [0.04, 0.37, ["Pullup Jump shot", "Jump Shot"]],
};

const CORNER_ANGLE = Math.atan2(89.5, 220);

function sampleZone(r) {
  let u = r();
  for (const [name, [w]] of Object.entries(ZONES)) { if ((u -= w) <= 0) return name; }
  return "above";
}

function sampleLoc(zone, r) {
  const polar = (r0, r1, a0, a1) => {
    const rad = r0 + r() * (r1 - r0), a = a0 + r() * (a1 - a0);
    return [Math.round(rad * Math.cos(a)), Math.round(rad * Math.sin(a))];
  };
  switch (zone) {
    case "rim": return polar(0, 38, -0.3, Math.PI + 0.3);
    case "paint": {
      const [x, y] = polar(45, 140, 0.35, Math.PI - 0.35);
      return [Math.max(-78, Math.min(78, x)), y];
    }
    case "mid": return polar(100, 225, 0.05, Math.PI - 0.05);
    case "corner": return [(r() < 0.5 ? -1 : 1) * Math.round(224 + r() * 18), Math.round(-40 + r() * 120)];
    case "above": return polar(240, 268, CORNER_ANGLE + 0.02, Math.PI - CORNER_ANGLE - 0.02);
    default: return polar(280, 330, 0.5, Math.PI - 0.5);
  }
}

function zoneName(zone, x) {
  return {
    rim: "Restricted Area", paint: "In The Paint (Non-RA)", mid: "Mid-Range",
    corner: x < 0 ? "Left Corner 3" : "Right Corner 3", above: "Above the Break 3", deep: "Above the Break 3",
  }[zone];
}

const OPPONENTS = ["BOT", "CPU", "NPC", "AIX", "ROM", "BIT", "PIX", "VGA", "LAG", "TTY"];

function makeGame(r, gi, season, hotStreak) {
  const gameId = `DEMO-${season}-${String(gi + 1).padStart(3, "0")}`;
  const startYear = parseInt(season, 10) || 2015;
  const d = new Date(Date.UTC(startYear, 9, 27 + Math.floor(gi * 2.1)));
  const gameDate = d.toISOString().slice(0, 10).replace(/-/g, "");
  const opp = OPPONENTS[gi % OPPONENTS.length];
  const homeGame = gi % 2 === 0;

  // Times on the floor (elapsed seconds) per quarter, with bench stints.
  const stints = [[0, 560], [900, 1440], [1440, 2000], [2340, 2880]];
  const nShots = 14 + Math.floor(r() * 12);
  const ts = [];
  for (let i = 0; i < nShots; i++) {
    const [a, b] = stints[Math.floor(r() * stints.length)];
    ts.push(a + 8 + r() * (b - a - 10));
  }
  ts.sort((a, b) => a - b);

  // Optional scripted heater: a quick run of threes in the 3rd quarter.
  if (hotStreak) {
    let t = 1500 + r() * 120;
    for (let k = 0; k < 5; k++) { ts.push(t); t += 35 + r() * 55; }
    ts.sort((a, b) => a - b);
  }

  // Mild streakiness so combos happen naturally too.
  let form = 0;
  const shots = ts.map((t, i) => {
    const forced = hotStreak && t >= 1500 && t < 2000;
    let zone = sampleZone(r);
    if (forced && r() < 0.8) zone = "above";
    const [x, y] = sampleLoc(zone, r);
    const [, p] = ZONES[zone];
    const made = forced ? r() < 0.85 : r() < Math.min(0.9, p + form);
    form = made ? Math.min(0.08, form + 0.03) : Math.max(-0.05, form - 0.03);
    const pts = zone === "corner" || zone === "above" || zone === "deep" ? 3 : 2;
    const period = Math.min(4, Math.floor(t / 720) + 1);
    const remaining = Math.round(period * 720 - t);
    const acts = ZONES[zone][2];
    return {
      id: `${gameId}-${i}`, gameId, gameDate, period, remaining,
      t: period * 720 - remaining, x, y, made, pts,
      action: (pts === 3 ? "3PT " : "") + acts[Math.floor(r() * acts.length)],
      zone: zoneName(zone, x), dist: Math.round(Math.hypot(x, y) / 10),
      home: homeGame ? "SPL" : opp, away: homeGame ? opp : "SPL",
    };
  });

  // A few trips to the line, mostly after drives.
  const freeThrows = [];
  shots.filter((s) => s.pts === 2 && r() < 0.25).forEach((s, k) => {
    for (let j = 0; j < 2; j++) {
      const made = r() < 0.9;
      freeThrows.push({
        id: `${gameId}-ft-${k}-${j}`, period: s.period, remaining: s.remaining,
        t: s.t + 0.5 + j * 0.5, made,
        desc: `${made ? "" : "MISS "}Splash Bot Free Throw ${j + 1} of 2`,
      });
    }
  });

  const fgPts = shots.reduce((n, s) => n + (s.made ? s.pts : 0), 0);
  const ftPts = freeThrows.filter((f) => f.made).length;
  const meta = {
    gameId,
    date: d.toISOString().slice(0, 10),
    matchup: homeGame ? `SPL vs. ${opp}` : `SPL @ ${opp}`,
    wl: r() < 0.7 ? "W" : "L",
    pts: fgPts + ftPts,
    fgm: shots.filter((s) => s.made).length, fga: shots.length,
    fg3m: shots.filter((s) => s.made && s.pts === 3).length,
    fg3a: shots.filter((s) => s.pts === 3).length,
  };
  return { meta, shots, freeThrows };
}

const seasonCache = new Map();

export function demoSeason(season) {
  if (seasonCache.has(season)) return seasonCache.get(season);
  const r = rng(hash("splash-bot-" + season));
  const n = 72;
  const hotGames = new Set([11, 37, 58]);
  const games = [];
  for (let gi = 0; gi < n; gi++) games.push(makeGame(r, gi, season, hotGames.has(gi)));
  const out = {
    games: games.map((g) => g.meta),
    shots: games.flatMap((g) => g.shots),
    byId: new Map(games.map((g) => [g.meta.gameId, g])),
  };
  seasonCache.set(season, out);
  return out;
}

export function demoGame(season, gameId) {
  const s = demoSeason(season);
  const g = s.byId.get(gameId) || s.byId.values().next().value;
  return { shots: g.shots, freeThrows: g.freeThrows, game: g.meta, player: DEMO_PLAYER };
}
