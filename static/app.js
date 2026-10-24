import { makeView, drawCourt } from "./court.js";
import { FireBorder, Particles, banner, shake, Synth } from "./effects.js";
import { DEMO_PLAYER, demoSeason, demoGame } from "./demo.js";

const $ = (s) => document.querySelector(s);
const el = {
  app: $("#app"), courtWrap: $("#court-wrap"), court: $("#court"), timeline: $("#timeline"),
  banners: $("#banners"), tooltip: $("#tooltip"), status: $("#status"), badge: $("#source-badge"),
  playerInput: $("#player-input"), playerList: $("#player-list"), season: $("#season"),
  seasonType: $("#season-type"), game: $("#game"), demo: $("#demo-toggle"),
  play: $("#btn-play"), prev: $("#btn-prev"), next: $("#btn-next"), burst: $("#btn-burst"),
  speed: $("#speed"), sound: $("#btn-sound"), hint: $("#timeline-hint"),
  legend: $("#legend"), zones: $("#zones"), feed: $("#feed"),
  sbPlayer: $("#sb-player"), sbSub: $("#sb-sub"), sbPts: $("#sb-pts"), sbClock: $("#sb-clock"),
  sbFg: $("#sb-fg"), sb3p: $("#sb-3p"), sbFt: $("#sb-ft"), sbCombo: $("#sb-combo"),
  heatFill: $("#heat-fill"), heatLabel: $("#heat-label"),
};

const DEFAULT_PLAYER = { id: 201939, name: "Stephen Curry" };
const FIRST_SEASON = 1996;   // shot locations start in 1996-97
const LATEST_SEASON = 2026;  // 2026-27
const BURST_WINDOW = 180;    // game seconds
const BURST_PTS = 10;        // points inside the window that count as a burst
const FLIGHT_MS = 650;

const REPLAY_SPEEDS = [[15, "15×"], [30, "30×"], [60, "60×"], [120, "120×"], [300, "300×"]];
const HEAT_SPEEDS = [[1, "1 场/秒"], [2, "2 场/秒"], [4, "4 场/秒"], [8, "8 场/秒"], [16, "16 场/秒"]];

const seasonStr = (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
const periodStart = (p) => (p <= 4 ? (p - 1) * 720 : 2880 + (p - 5) * 300);
const periodOf = (t) => (t < 2880 ? Math.min(4, Math.floor(t / 720) + 1) : 5 + Math.floor((t - 2880) / 300));
const periodName = (p) => (p <= 4 ? `Q${p}` : `OT${p - 4}`);
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const clockAt = (t, end) => {
  const p = Math.min(periodOf(Math.min(t, end - 0.001)), periodOf(end - 0.001));
  const len = p <= 4 ? 720 : 300;
  return `${periodName(p)} ${mmss(periodStart(p) + len - t)}`;
};
const fmtDate = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || "");
const pct = (m, a) => (a ? `${Math.round((100 * m) / a)}%` : "—");

// Last index i with arr[i][key] <= v (or -1).
function lastIndexLE(arr, v, key) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// ------------------------------------------------------------------ state

const params = new URLSearchParams(location.search);
const state = {
  mode: params.get("mode") === "heat" ? "heat" : "replay",
  view: "hex",
  demo: params.get("demo") === "1" || location.protocol === "file:",
  player: params.get("player")
    ? { id: Number(params.get("player")), name: params.get("name") || params.get("player") }
    : DEFAULT_PLAYER,
  season: params.get("season") || "2015-16",
  seasonType: params.get("type") === "Playoffs" ? "Playoffs" : "Regular Season",
  gameId: params.get("game"),
  games: [], seasonShots: [],
  // replay
  events: [], after: [], bursts: [], end: 2880, meta: null,
  T: 0, cursor: -1, shown: -1, flights: [], slowUntil: 0,
  // season time-lapse
  heatShots: [], heatT: 0, heatN: 0, heatCount: 0, bins: null, binsCount: -1,
  playing: false,
  speed: { replay: 60, heat: 4 },
  hover: null,
};

const fire = new FireBorder($("#fire"));
const particles = new Particles();
const synth = new Synth();
let view, courtBg;

// ------------------------------------------------------------------ data

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try { detail = (await r.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return r.json();
}

function setStatus(msg, kind = "") {
  el.status.hidden = !msg;
  el.status.textContent = msg || "";
  el.status.className = `status ${kind}`;
}

function updateBadge() {
  el.badge.textContent = state.demo ? "DEMO · 合成数据" : "LIVE · nba_api";
  el.badge.classList.toggle("demo", state.demo);
  el.demo.classList.toggle("active", state.demo);
  el.playerInput.value = state.demo ? DEMO_PLAYER.name : state.player.name;
  el.playerInput.disabled = state.demo;
}

// Static hosting (GitHub Pages, an artifact preview, file://) has no /api.
async function hasBackend() {
  try {
    const r = await fetch("/api/health");
    return r.ok && (await r.json()).ok === true;
  } catch { return false; }
}

const STATIC_NOTE = "静态预览：当前页面没有连接后端，下面是程序生成的合成演示数据，不是真实比赛。" +
  "要看真实 NBA 数据，请在本机运行 `uvicorn backend.server:app` 后打开 http://localhost:8000。";

function fallbackToDemo(err) {
  state.demo = true;
  updateBadge();
  if (!backendUp) { setStatus(STATIC_NOTE); return; }
  setStatus(
    `无法从 stats.nba.com 获取数据（${err.message.slice(0, 140)}…）。已切换到离线演示模式：下面是程序生成的合成数据，不是真实比赛。` +
    `请在本机运行 \`uvicorn backend.server:app\`，然后点 DEMO 关闭演示模式重试。`,
    "error",
  );
}

function deriveGames(shots) {
  const map = new Map();
  for (const s of shots) {
    let g = map.get(s.gameId);
    if (!g) {
      g = { gameId: s.gameId, date: fmtDate(s.gameDate), matchup: `${s.away} @ ${s.home}`, wl: "", pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, fgOnly: true };
      map.set(s.gameId, g);
    }
    g.fga++; if (s.pts === 3) g.fg3a++;
    if (s.made) { g.fgm++; g.pts += s.pts; if (s.pts === 3) g.fg3m++; }
  }
  return [...map.values()];
}

let seasonToken = 0;
async function loadSeason() {
  const token = ++seasonToken;
  pause();
  if (!state.demo) setStatus("读取中 LOADING… 首次请求 stats.nba.com 可能要几秒。");
  let shots = null, games = null;
  if (!state.demo) {
    const q = `player_id=${state.player.id}&season=${state.season}&season_type=${encodeURIComponent(state.seasonType)}`;
    try {
      const [s, g] = await Promise.all([api(`/api/shots?${q}`), api(`/api/games?${q}`).catch(() => null)]);
      shots = s.shots; games = g;
      if (s.player?.name) state.player.name = s.player.name;
      setStatus(shots.length ? "" : `${state.player.name} 在 ${state.season} ${state.seasonType} 没有出手记录。`);
    } catch (err) {
      if (token !== seasonToken) return;
      fallbackToDemo(err);
    }
  }
  if (token !== seasonToken) return;
  if (state.demo) {
    const d = demoSeason(state.season);
    shots = d.shots; games = d.games;
  }
  const withShots = new Set(shots.map((s) => s.gameId));
  games = (games && games.length ? games : deriveGames(shots)).filter((g) => withShots.has(g.gameId));

  state.seasonShots = shots;
  state.games = games;
  updateBadge();
  fillGameSelect();
  prepareHeat();

  if (!games.some((g) => g.gameId === state.gameId)) {
    const best = games.reduce((a, g) => (!a || g.pts > a.pts ? g : a), null);
    state.gameId = best?.gameId || null;
  }
  el.game.value = state.gameId || "";
  await loadGame(state.gameId);
}

function fillGameSelect() {
  const top = [...state.games].sort((a, b) => b.pts - a.pts).slice(0, 3).map((g) => g.gameId);
  el.game.innerHTML = state.games.map((g) => {
    const flame = top.includes(g.gameId) ? "🔥 " : "";
    const pts = g.fgOnly ? `${g.pts} FG PTS` : `${g.pts} PTS`;
    return `<option value="${g.gameId}">${flame}${g.date} ${g.matchup} ${g.wl || ""} · ${pts} · 3PT ${g.fg3m}/${g.fg3a}</option>`;
  }).join("") || `<option value="">（无比赛）</option>`;
}

let gameToken = 0;
async function loadGame(gameId) {
  const token = ++gameToken;
  pause();
  if (!gameId) { buildReplay([], [], null); render(); return; }
  let shots, fts = null, meta = state.games.find((g) => g.gameId === gameId) || null;
  if (state.demo) {
    const d = demoGame(state.season, gameId);
    shots = d.shots; fts = d.freeThrows; meta = d.game;
  } else {
    shots = state.seasonShots.filter((s) => s.gameId === gameId);
    try {
      fts = await api(`/api/freethrows?player_id=${state.player.id}&game_id=${gameId}`);
    } catch { fts = null; }
  }
  if (token !== gameToken) return;
  state.gameId = gameId;
  buildReplay(shots, fts, meta);
  syncUrl();
  render();
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.demo) p.set("demo", "1");
  else { p.set("player", state.player.id); p.set("name", state.player.name); }
  p.set("season", state.season);
  if (state.seasonType !== "Regular Season") p.set("type", state.seasonType);
  if (state.gameId) p.set("game", state.gameId);
  p.set("mode", state.mode);
  try { history.replaceState(null, "", `?${p}`); } catch { /* sandboxed preview frames may refuse */ }
}

// ------------------------------------------------------------------ replay model

// Precompute the scoreboard / combo state after every event so scrubbing is
// just a lookup and playback only has to fire the effects.
function buildReplay(shots, fts, meta) {
  const events = [
    ...shots.map((s) => ({ ...s, kind: "fg" })),
    ...(fts || []).map((f) => ({ ...f, kind: "ft", pts: 1 })),
  ].sort((a, b) => a.t - b.t || (a.kind === "fg" ? -1 : 1));

  const s = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, streak: 0, threes: 0, fire: false, best: 0 };
  const after = [];
  let lastBurst = -Infinity, w0 = 0, windowPts = 0;
  const hotSpans = [];
  events.forEach((e, i) => {
    const trig = [];
    if (e.kind === "ft") {
      s.fta++; if (e.made) { s.ftm++; s.pts++; }
    } else {
      s.fga++; if (e.pts === 3) s.tpa++;
      if (e.made) {
        s.fgm++; s.pts += e.pts; if (e.pts === 3) { s.tpm++; s.threes++; }
        s.streak++; s.best = Math.max(s.best, s.streak);
        // NBA-Jam rule, adapted: three made threes without a miss lights you up;
        // after that any make keeps the fire going and a miss puts it out.
        if (!s.fire && s.threes >= 3) { s.fire = true; trig.push("fire"); }
        else if (!s.fire && s.streak === 2) trig.push("heating");
      } else {
        if (s.fire) trig.push("cool");
        s.fire = false; s.streak = 0; s.threes = 0;
      }
    }
    // Rolling scoring window for "burst" detection.
    if (e.made) windowPts += e.pts;
    while (events[w0].t <= e.t - BURST_WINDOW) { if (events[w0].made) windowPts -= events[w0].pts; w0++; }
    if (e.made && windowPts >= BURST_PTS) {
      const first = events.slice(w0, i + 1).find((x) => x.made);
      hotSpans.push([first.t, e.t]);
      if (e.t - lastBurst > BURST_WINDOW) { trig.push("burst"); lastBurst = e.t; }
    }
    after.push({ ...s, windowPts, trig, onFire: s.fire && e.kind === "fg" && e.made });
  });

  // Merge overlapping hot windows into timeline bands.
  const bursts = [];
  for (const [a, b] of hotSpans) {
    const last = bursts[bursts.length - 1];
    if (last && a <= last.t1) last.t1 = Math.max(last.t1, b);
    else bursts.push({ t0: a, t1: b });
  }
  for (const b of bursts) {
    b.pts = events.filter((e) => e.made && e.t >= b.t0 && e.t <= b.t1).reduce((n, e) => n + e.pts, 0);
  }

  const maxPeriod = events.reduce((m, e) => Math.max(m, e.period || periodOf(e.t)), 4);
  Object.assign(state, {
    events, after, bursts, meta, hasFT: fts !== null,
    end: periodStart(maxPeriod + 1),
    T: 0, cursor: -1, shown: -1, flights: [],
  });
  el.feed.innerHTML = "";
  fire.set(0);
  setFireClass(0);
  updateScoreboard(false);
}

function heatLevel(a) {
  if (!a) return 0;
  if (a.fire) return 2;
  return a.streak >= 2 ? 1 : 0;
}

function setFireClass(level) {
  document.body.classList.toggle("on-fire", level === 2);
  document.body.classList.toggle("heating", level === 1);
}

function scrubReplay(T) {
  state.T = Math.max(0, Math.min(state.end, T));
  state.cursor = lastIndexLE(state.events, state.T, "t");
  state.shown = state.cursor;
  state.flights = [];
  const a = state.after[state.shown];
  fire.set(heatLevel(a));
  setFireClass(heatLevel(a));
  rebuildFeed();
  updateScoreboard(false);
}

function launch(i, now) {
  // Free throws have no flight but still queue behind balls in the air,
  // so the scoreboard and log stay in game order.
  const e = state.events[i];
  if (e.kind === "ft" && !state.flights.length) land(i);
  else state.flights.push({ i, start: now, ft: e.kind === "ft" });
}

function land(i) {
  const e = state.events[i], a = state.after[i];
  state.shown = Math.max(state.shown, i);
  const p = view.px(0), rimY = view.py(0);
  if (e.kind === "ft") {
    synth.ft(e.made);
    if (e.made) particles.text(view.px(0), view.py(142.5) - 10 * view.dpr, "+1", "#b9b0e6", 12);
  } else if (e.made) {
    const hot = a.fire;
    particles.ring(p, rimY, hot ? "#ff8a1f" : "#3df5ff", hot ? 70 : 45);
    particles.burst(p, rimY, {
      n: hot ? 60 : e.pts === 3 ? 34 : 20, speed: hot ? 6 : 4,
      colors: hot ? ["#fff3c4", "#ffb000", "#ff4d1a"] : e.pts === 3 ? ["#ffd23f", "#ffffff", "#ff8a1f"] : ["#3df5ff", "#ffffff"],
    });
    particles.text(p, rimY + 40 * view.dpr, `+${e.pts}`, e.pts === 3 ? "#ffd23f" : "#3df5ff", e.pts === 3 ? 22 : 16);
    synth.swish(e.pts);
    if (e.pts === 3 && !a.trig.length) shake(el.courtWrap);
  } else {
    particles.burst(view.px(e.x * 0.15), view.py(e.y * 0.15), { n: 10, speed: 2, colors: ["#7d74ad", "#ff3d7f"], life: 0.5 });
    particles.text(p, rimY + 36 * view.dpr, "MISS", "#ff3d7f", 10);
    synth.brick();
  }

  for (const t of a.trig) {
    if (t === "fire") {
      banner(el.banners, "ON FIRE!!", "fire");
      shake(document.body, "big");
      synth.fire();
      state.slowUntil = performance.now() + 1800;
    } else if (t === "heating") {
      banner(el.banners, "HEATING UP!");
      synth.heating();
    } else if (t === "cool") {
      banner(el.banners, "COOLED OFF", "cool");
      synth.cool();
    } else if (t === "burst" && !a.trig.includes("fire")) {
      banner(el.banners, `BURST! ${a.windowPts} PTS / 3 MIN`, "small");
    }
  }
  const lvl = heatLevel(a);
  fire.set(lvl);
  setFireClass(lvl);
  addFeedItem(i, true);
  updateScoreboard(true);
}

function feedHtml(i) {
  const e = state.events[i], a = state.after[i];
  const t = `${periodName(e.period || periodOf(e.t))} ${mmss(e.remaining)}`;
  const what = e.kind === "ft" ? "罚球 Free Throw" : `${e.dist}ft ${e.action}`;
  const res = e.made ? `+${e.pts}` : "MISS";
  const flame = a.onFire ? " 🔥" : "";
  return { cls: `${e.made ? "made" : "miss"}${a.onFire ? " fire" : ""}`, html: `<span class="t">${t}</span><span>${what} <b class="r">${res}</b>${flame}</span>` };
}

function addFeedItem(i, fresh) {
  const { cls, html } = feedHtml(i);
  const li = document.createElement("li");
  li.className = cls + (fresh ? " new" : "");
  li.innerHTML = html;
  el.feed.prepend(li);
  while (el.feed.children.length > 40) el.feed.lastChild.remove();
}

function rebuildFeed() {
  el.feed.innerHTML = "";
  for (let i = Math.max(0, state.shown - 39); i <= state.shown; i++) addFeedItem(i, false);
}

function bump(node, value) {
  if (node.textContent !== String(value)) {
    node.textContent = value;
    node.classList.remove("bump"); void node.offsetWidth; node.classList.add("bump");
  }
}

function updateScoreboard(animate) {
  const who = state.demo ? DEMO_PLAYER.name : state.player.name;
  el.sbPlayer.textContent = who;
  if (state.mode === "replay") {
    const a = state.after[state.shown] || { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, streak: 0, threes: 0 };
    const m = state.meta;
    el.sbSub.textContent = m ? `${m.date} ${m.matchup} ${m.wl || ""}` : "";
    (animate ? bump : (n, v) => (n.textContent = v))(el.sbPts, a.pts);
    el.sbClock.textContent = clockAt(state.T, state.end);
    el.sbFg.textContent = `${a.fgm}/${a.fga}`;
    el.sb3p.textContent = `${a.tpm}/${a.tpa}`;
    el.sbFt.textContent = state.hasFT ? `${a.ftm}/${a.fta}` : "N/A";
    el.sbCombo.textContent = `x${a.streak}`;
    const lvl = a.fire ? 1 : Math.min(0.85, a.streak * 0.22 + a.threes * 0.12);
    el.heatFill.style.width = `${Math.round(lvl * 100)}%`;
    el.heatLabel.textContent = a.fire ? "🔥 ON FIRE 🔥" : a.streak >= 2 ? "HEATING UP" : a.streak === 1 ? "WARM" : "COLD";
  } else {
    const n = state.heatCount;
    const shots = state.heatShots.slice(0, n);
    const made = shots.filter((s) => s.made);
    const threes = shots.filter((s) => s.pts === 3);
    const g = Math.min(state.heatN, Math.floor(state.heatT) + (state.heatT < state.heatN ? 1 : 0));
    el.sbSub.textContent = `${state.season} ${state.seasonType === "Playoffs" ? "季后赛" : "常规赛"} · 赛季热区时光机`;
    el.sbPts.textContent = made.reduce((p, s) => p + s.pts, 0);
    el.sbClock.textContent = `G ${g}/${state.heatN}`;
    el.sbFg.textContent = `${made.length}/${shots.length}`;
    el.sb3p.textContent = `${threes.filter((s) => s.made).length}/${threes.length}`;
    el.sbFt.textContent = "—";
    el.sbCombo.textContent = "—";
    el.heatFill.style.width = `${state.heatN ? Math.round((100 * state.heatT) / state.heatN) : 0}%`;
    el.heatLabel.textContent = "SEASON PROGRESS";
  }
}

// ------------------------------------------------------------------ season heat model

const HEX_R = 12;
const SQRT3 = Math.sqrt(3);

function prepareHeat() {
  const idx = new Map(state.games.map((g, i) => [g.gameId, i]));
  state.heatShots = state.seasonShots
    .filter((s) => idx.has(s.gameId))
    .map((s) => ({ ...s, u: idx.get(s.gameId) + Math.min(0.999, s.t / 2880) }))
    .sort((a, b) => a.u - b.u);
  state.heatN = state.games.length;
  state.heatT = state.heatN;
  state.binsCount = -1;
  updateHeatCount();
}

function updateHeatCount() {
  state.heatCount = lastIndexLE(state.heatShots, state.heatT, "u") + 1;
}

function hexKey(x, y) {
  const q = (SQRT3 / 3 * x - y / 3) / HEX_R, r = (2 / 3 * y) / HEX_R;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
  return [rx, rz];
}

function computeBins() {
  if (state.binsCount === state.heatCount) return state.bins;
  const map = new Map();
  for (let i = 0; i < state.heatCount; i++) {
    const s = state.heatShots[i];
    const [q, r] = hexKey(s.x, s.y);
    const k = `${q},${r}`;
    let b = map.get(k);
    if (!b) { b = { q, r, cx: HEX_R * SQRT3 * (q + r / 2), cy: HEX_R * 1.5 * r, att: 0, made: 0, pts: 0 }; map.set(k, b); }
    b.att++; if (s.made) { b.made++; b.pts += s.pts; }
  }
  const bins = [...map.values()];
  const atts = bins.map((b) => b.att).sort((a, b) => a - b);
  // Cap the size scale at the 90th percentile so the rim doesn't dwarf everything.
  const cap = Math.max(3, atts[Math.floor(atts.length * 0.9)] || 1);
  for (const b of bins) {
    b.size = Math.max(0.3, Math.sqrt(Math.min(b.att, cap) / cap));
    b.pps = b.pts / b.att;
    // shrink small samples towards 1.0 PPS so a single make isn't "red hot"
    b.ppsAdj = (b.pts + 2 * 1.0) / (b.att + 2);
  }
  state.bins = { list: bins, map };
  state.binsCount = state.heatCount;
  return state.bins;
}

// Diverging: cold blue <- neutral grey (1.0 points per shot) -> hot red.
const RAMP = [[0.6, [43, 108, 255]], [0.8, [111, 143, 224]], [1.0, [91, 88, 115]], [1.2, [255, 138, 92]], [1.4, [255, 59, 47]]];
function ppsColor(v) {
  if (v <= RAMP[0][0]) return `rgb(${RAMP[0][1]})`;
  for (let i = 1; i < RAMP.length; i++) {
    const [x1, c1] = RAMP[i], [x0, c0] = RAMP[i - 1];
    if (v <= x1) {
      const k = (v - x0) / (x1 - x0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k))})`;
    }
  }
  return `rgb(${RAMP[RAMP.length - 1][1]})`;
}

// ------------------------------------------------------------------ rendering: court

function setupCanvas() {
  view = makeView(el.court);
  courtBg = document.createElement("canvas");
  courtBg.width = el.court.width; courtBg.height = el.court.height;
  drawCourt(courtBg.getContext("2d"), view);
  sizeTimeline();
}

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const x = view.px(cx + r * Math.cos(a)), y = view.py(cy + r * Math.sin(a));
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function drawShotMark(ctx, s, { alpha = 1, hot = false, big = false } = {}) {
  const x = view.px(s.x), y = view.py(s.y), d = view.dpr;
  const r = (big ? 7 : 4.5) * d;
  ctx.globalAlpha = alpha;
  if (s.made) {
    ctx.fillStyle = hot ? "#ff6a1a" : s.pts === 3 ? "#ffd23f" : "#3df5ff";
    if (hot) { ctx.shadowColor = "#ff4d1a"; ctx.shadowBlur = 12 * d; }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#120a2a"; ctx.lineWidth = 1.5 * d; ctx.stroke();
  } else {
    ctx.strokeStyle = "#ff3d7f"; ctx.lineWidth = 2 * d;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawBall(ctx, f, now) {
  const e = state.events[f.i];
  const p = Math.min(1, (now - f.start) / FLIGHT_MS);
  const k = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const gx = e.x * (1 - k), gy = e.y * (1 - k);
  const h = 4 * p * (1 - p);                 // fake height for a top-down arc
  const d = view.dpr;
  // shadow on the floor
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath(); ctx.ellipse(view.px(gx), view.py(gy), 6 * d, 3 * d, 0, 0, Math.PI * 2); ctx.fill();
  // ball, lifted "towards the camera"
  const bx = view.px(gx), by = view.py(gy) - h * 40 * d, br = (6 + h * 6) * d;
  const onFire = state.after[f.i - 1]?.fire;
  if (onFire) {
    ctx.fillStyle = "rgba(255,120,20,0.35)";
    for (let j = 1; j <= 5; j++) {
      const pj = Math.max(0, p - j * 0.04), kj = pj < 0.5 ? 2 * pj * pj : 1 - (-2 * pj + 2) ** 2 / 2;
      const hj = 4 * pj * (1 - pj);
      ctx.beginPath();
      ctx.arc(view.px(e.x * (1 - kj)), view.py(e.y * (1 - kj)) - hj * 40 * d, br * (1 - j * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "#ff8a1f";
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#5a2200"; ctx.lineWidth = 1.2 * d;
  ctx.beginPath(); ctx.moveTo(bx - br, by); ctx.lineTo(bx + br, by); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx, by, br, -Math.PI / 2 + 0.6, Math.PI / 2 - 0.6); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx, by, br, Math.PI / 2 + 0.6, (3 * Math.PI) / 2 - 0.6); ctx.stroke();
  return p >= 1;
}

function renderCourt(dt, now) {
  const ctx = el.court.getContext("2d");
  ctx.drawImage(courtBg, 0, 0);

  if (state.mode === "heat") {
    if (state.view === "hex") {
      const { list } = computeBins();
      for (const b of list) {
        hexPath(ctx, b.cx, b.cy, HEX_R * 0.95 * b.size);
        ctx.fillStyle = ppsColor(b.ppsAdj);
        ctx.fill();
        if (state.hover?.bin === b) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * view.dpr; ctx.stroke(); }
      }
    } else {
      for (let i = 0; i < state.heatCount; i++) drawShotMark(ctx, state.heatShots[i], { alpha: 0.75 });
    }
    // flash the shots of the game currently being "played back"
    if (state.playing) {
      for (let i = state.heatCount - 1; i >= 0 && state.heatShots[i].u > state.heatT - 0.6; i--) {
        drawShotMark(ctx, state.heatShots[i], { big: true, alpha: 1 - (state.heatT - state.heatShots[i].u) / 0.6 });
      }
    }
  } else {
    for (let i = 0; i <= state.shown; i++) {
      const e = state.events[i];
      if (e.kind !== "fg") continue;
      const recent = state.shown - i < 3;
      drawShotMark(ctx, e, { hot: state.after[i].onFire, big: i === state.shown, alpha: recent ? 1 : 0.7 });
    }
    let blocked = false;
    state.flights = state.flights.filter((f) => {
      const done = f.ft || drawBall(ctx, f, now);
      if (done && !blocked) { land(f.i); return false; }
      blocked = true;
      return true;
    });
    if (state.hover?.shot) {
      const s = state.hover.shot;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * view.dpr;
      ctx.beginPath(); ctx.arc(view.px(s.x), view.py(s.y), 10 * view.dpr, 0, Math.PI * 2); ctx.stroke();
    }
  }
  particles.tick(ctx, dt, view.dpr);
}

// ------------------------------------------------------------------ rendering: timeline

let tl = { w: 0, h: 0, dpr: 1, pad: 10 };
function sizeTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const w = el.timeline.clientWidth, h = el.timeline.clientHeight;
  el.timeline.width = w * dpr; el.timeline.height = h * dpr;
  tl = { w, h, dpr, pad: 10 };
}
const tlDomain = () => (state.mode === "heat" ? Math.max(1, state.heatN) : state.end);
const tlX = (t) => tl.pad + (t / tlDomain()) * (tl.w - 2 * tl.pad);
const tlT = (x) => ((x - tl.pad) / (tl.w - 2 * tl.pad)) * tlDomain();

function renderTimeline() {
  const ctx = el.timeline.getContext("2d");
  const { w, h, dpr } = tl;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const font = (px) => `${px}px "Press Start 2P", monospace`;
  const base = h - 22;

  if (state.mode === "replay") {
    const { events, after, end } = state;
    for (let p = 1; periodStart(p) < end; p++) {
      const x0 = tlX(periodStart(p)), x1 = tlX(Math.min(end, periodStart(p + 1)));
      ctx.fillStyle = p % 2 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(x0, 0, x1 - x0, base);
      ctx.fillStyle = "#7d74ad"; ctx.font = font(8); ctx.textAlign = "center";
      ctx.fillText(periodName(p), (x0 + x1) / 2, h - 6);
    }
    for (const b of state.bursts) {
      const x0 = tlX(b.t0) - 3, x1 = tlX(b.t1) + 3;
      ctx.fillStyle = "rgba(255,77,26,0.22)";
      ctx.fillRect(x0, 0, x1 - x0, base);
      ctx.fillStyle = "#ff8a1f"; ctx.font = font(7); ctx.textAlign = "center";
      ctx.fillText(`+${b.pts}`, (x0 + x1) / 2, 10);
    }
    // cumulative points ("score worm")
    const maxPts = Math.max(10, after.length ? after[after.length - 1].pts : 0);
    const wy = (pts) => base - 4 - (pts / maxPts) * (base - 22);
    const drawWorm = (upto, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tlX(0), wy(0));
      let pts = 0;
      for (let i = 0; i < events.length && events[i].t <= upto; i++) {
        ctx.lineTo(tlX(events[i].t), wy(pts));
        pts = after[i].pts;
        ctx.lineTo(tlX(events[i].t), wy(pts));
      }
      ctx.lineTo(tlX(upto), wy(pts));
      ctx.stroke();
    };
    drawWorm(end, "rgba(255,210,63,0.25)");
    drawWorm(state.T, "#ffd23f");
    // event ticks
    events.forEach((e, i) => {
      const x = tlX(e.t), past = i <= state.shown;
      ctx.globalAlpha = past ? 1 : 0.35;
      if (e.kind === "ft") {
        ctx.fillStyle = e.made ? "#b9b0e6" : "#4b4378";
        ctx.fillRect(x - 1.5, base - 5, 3, 3);
      } else if (e.made) {
        ctx.fillStyle = after[i].onFire ? "#ff4d1a" : e.pts === 3 ? "#ffd23f" : "#3df5ff";
        const th = e.pts === 3 ? 26 : 16;
        ctx.fillRect(x - 1.5, base - th, 3, th);
      } else {
        ctx.fillStyle = "#ff3d7f";
        ctx.fillRect(x - 1, base - 7, 2, 7);
      }
    });
    ctx.globalAlpha = 1;
    if (state.hover?.tlEvent != null) {
      const x = tlX(events[state.hover.tlEvent].t);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(x - 4, base - 30, 8, 30);
    }
  } else {
    const n = state.heatN;
    const maxPts = Math.max(10, ...state.games.map((g) => g.pts));
    const cur = Math.floor(state.heatT - 1e-9);
    state.games.forEach((g, i) => {
      const x0 = tlX(i) + 1, x1 = tlX(i + 1) - 1;
      const bh = (g.pts / maxPts) * (base - 14);
      ctx.fillStyle = i === cur ? "#ffd23f" : i < state.heatT ? "#b9b0e6" : "#3a2a78";
      ctx.fillRect(x0, base - bh, Math.max(1, x1 - x0), bh);
    });
    ctx.fillStyle = "#7d74ad"; ctx.font = font(7); ctx.textAlign = "center";
    for (let i = 0; i < n; i += 10) ctx.fillText(`G${i + 1}`, tlX(i + 0.5), h - 6);
    if (state.hover?.tlGame != null) {
      const i = state.hover.tlGame;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(tlX(i), 0, tlX(i + 1) - tlX(i), base);
    }
  }

  // playhead
  const T = state.mode === "heat" ? state.heatT : state.T;
  const x = tlX(T);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, base); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.moveTo(x - 5, base); ctx.lineTo(x + 5, base); ctx.lineTo(x, base - 7); ctx.fill();
}

// ------------------------------------------------------------------ side panels

const ZONE_GROUPS = [
  ["篮下 Restricted Area", (s) => s.zone === "Restricted Area"],
  ["油漆区 Paint", (s) => s.zone === "In The Paint (Non-RA)"],
  ["中距离 Mid-Range", (s) => s.zone === "Mid-Range"],
  ["底角三分 Corner 3", (s) => /Corner 3/.test(s.zone)],
  ["弧顶三分 Above Break 3", (s) => s.zone === "Above the Break 3"],
  ["超远 Backcourt", (s) => s.zone === "Backcourt"],
];

let lastZonesKey = "";
function renderZones() {
  const shots = state.mode === "heat"
    ? state.heatShots.slice(0, state.heatCount)
    : state.events.slice(0, state.shown + 1).filter((e) => e.kind === "fg");
  const key = `${state.mode}-${shots.length}-${state.gameId}`;
  if (key === lastZonesKey) return;
  lastZonesKey = key;
  const total = shots.length || 1;
  el.zones.innerHTML = ZONE_GROUPS.map(([name, f]) => {
    const z = shots.filter(f);
    if (!z.length && name.startsWith("超远")) return "";
    const m = z.filter((s) => s.made).length;
    return `<tr><td>${name}<div class="bar"><i style="width:${(100 * z.length) / total}%"></i></div></td>` +
      `<td>${m}/${z.length}</td><td>${pct(m, z.length)}</td></tr>`;
  }).join("");
}

function renderLegend() {
  if (state.mode === "heat" && state.view === "hex") {
    const stops = RAMP.map(([v]) => `${ppsColor(v)} ${((v - 0.6) / 0.8) * 100}%`).join(",");
    el.legend.innerHTML =
      `<div>颜色 = 每次出手得分 (PPS，小样本向 1.0 收缩)</div>` +
      `<div class="legend-row"><div class="legend-ramp" style="background:linear-gradient(90deg,${stops})"></div></div>` +
      `<div class="legend-ends"><span>≤0.6 冷</span><span>1.0</span><span>≥1.4 热</span></div>` +
      `<div class="legend-row" style="margin-top:8px">六边形大小 = 出手次数</div>`;
  } else {
    const dot = (c, label, extra = "") => `<div class="legend-row"><span class="swatch" style="background:${c};${extra}"></span>${label}</div>`;
    el.legend.innerHTML =
      dot("#3df5ff", "命中两分 Made 2") +
      dot("#ffd23f", "命中三分 Made 3") +
      `<div class="legend-row"><span style="color:#ff3d7f;font-weight:bold;width:14px;text-align:center">✕</span>未命中 Miss</div>` +
      (state.mode === "replay" ? dot("#ff6a1a", "ON FIRE 状态下命中", "box-shadow:0 0 8px #ff4d1a") : "");
  }
}

function hintText() {
  if (state.hover?.text) return state.hover.text;
  if (state.mode === "heat") return "拖动时间轴 = 按比赛累积热区 · 点 ▶ 看整季热区一场场长出来 · 双击某场柱子进入该场时光机";
  return `拖动/点击时间轴跳转 · 空格 播放 · ←/→ 逐次出手 · 橙色带 = 得分爆发（${BURST_WINDOW / 60} 分钟内 ≥${BURST_PTS} 分）· 连中 3 记三分 = ON FIRE`;
}

// ------------------------------------------------------------------ main loop

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.playing) advance(dt, now);
  render(dt, now);
  fire.tick(dt);
  requestAnimationFrame(frame);
}

function advance(dt, now) {
  if (state.mode === "heat") {
    state.heatT = Math.min(state.heatN, state.heatT + dt * state.speed.heat);
    updateHeatCount();
    if (state.heatT >= state.heatN) pause();
    return;
  }
  let sp = state.speed.replay;
  if (now < state.slowUntil) sp *= 0.3;
  let T2 = state.T + dt * sp;
  const next = state.events[state.cursor + 1];
  // Fast-forward through dead time (bench stints, timeouts) between shots.
  if (next && next.t - state.T > 25 && !state.flights.length) {
    T2 = Math.min(next.t, state.T + dt * sp * 8);
  }
  while (state.events[state.cursor + 1] && state.events[state.cursor + 1].t <= T2) {
    state.cursor++;
    launch(state.cursor, now);
  }
  state.T = Math.min(T2, state.end);
  if (state.T >= state.end && !state.flights.length) {
    pause();
    const a = state.after[state.shown];
    banner(el.banners, a ? `FINAL · ${a.pts} PTS` : "FINAL");
  }
}

function render(dt = 0, now = performance.now()) {
  if (!view) return;
  renderCourt(dt, now);
  renderTimeline();
  renderZones();
  if (state.mode === "replay") el.sbClock.textContent = clockAt(state.T, state.end);
  else updateScoreboard(false);
}

// ------------------------------------------------------------------ controls

function play() {
  synth.ensure();
  if (state.mode === "heat") {
    if (state.heatT >= state.heatN) { state.heatT = 0; updateHeatCount(); }
  } else if (state.T >= state.end) {
    scrubReplay(0);
  }
  state.playing = true;
  el.play.textContent = "⏸";
}

function pause() {
  state.playing = false;
  el.play.textContent = "▶";
}

function stepNext() {
  pause();
  if (state.mode === "heat") { state.heatT = Math.min(state.heatN, Math.floor(state.heatT + 1e-9) + 1); updateHeatCount(); return; }
  // land anything still in the air first
  state.flights.forEach((f) => land(f.i));
  state.flights = [];
  const i = state.cursor + 1;
  if (i >= state.events.length) return;
  state.cursor = i;
  state.T = state.events[i].t;
  launch(i, performance.now());
}

function stepPrev() {
  pause();
  if (state.mode === "heat") { state.heatT = Math.max(0, Math.ceil(state.heatT - 1e-9) - 1); updateHeatCount(); return; }
  const target = state.events[state.shown - 1];
  scrubReplay(target ? target.t : 0);
}

function nextBurst() {
  if (state.mode !== "replay" || !state.bursts.length) return;
  const b = state.bursts.find((x) => x.t0 > state.T + 1) || state.bursts[0];
  scrubReplay(Math.max(0, b.t0 - 20));
  banner(el.banners, `🔥 ${clockAt(b.t0, state.end)} · +${b.pts}`, "small");
  play();
}

function setMode(mode) {
  pause();
  state.mode = mode;
  document.body.classList.toggle("mode-heat", mode === "heat");
  document.body.classList.toggle("mode-replay", mode === "replay");
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  const speeds = mode === "heat" ? HEAT_SPEEDS : REPLAY_SPEEDS;
  el.speed.innerHTML = speeds.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  el.speed.value = state.speed[mode];
  if (mode === "heat") { fire.set(0); setFireClass(0); }
  else { const lvl = heatLevel(state.after[state.shown]); fire.set(lvl); setFireClass(lvl); }
  state.hover = null;
  el.tooltip.hidden = true;
  lastZonesKey = "";
  renderLegend();
  updateScoreboard(false);
  el.hint.textContent = hintText();
  syncUrl();
}

function setView(v) {
  state.view = v;
  document.querySelectorAll("#view-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  renderLegend();
}

function scrubAt(clientX) {
  const rect = el.timeline.getBoundingClientRect();
  const t = Math.max(0, Math.min(tlDomain(), tlT(clientX - rect.left)));
  if (state.mode === "heat") { state.heatT = t; updateHeatCount(); }
  else scrubReplay(t);
}

// timeline pointer
let dragging = false;
el.timeline.addEventListener("pointerdown", (ev) => {
  dragging = true; el.timeline.setPointerCapture(ev.pointerId);
  pause(); scrubAt(ev.clientX);
});
el.timeline.addEventListener("pointermove", (ev) => {
  if (dragging) { scrubAt(ev.clientX); return; }
  const rect = el.timeline.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  state.hover = null;
  if (state.mode === "replay") {
    let best = -1, bd = 7;
    state.events.forEach((e, i) => { const d = Math.abs(tlX(e.t) - x); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) {
      const e = state.events[best];
      const { html } = feedHtml(best);
      state.hover = { tlEvent: best, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
      if (e.kind === "fg") state.hover.shot = e;
    }
  } else {
    const i = Math.floor(tlT(x));
    const g = state.games[i];
    if (g) state.hover = { tlGame: i, text: `G${i + 1} · ${g.date} ${g.matchup} ${g.wl || ""} · ${g.pts} PTS · 3PT ${g.fg3m}/${g.fg3a}（双击回放）` };
  }
  el.hint.textContent = hintText();
});
el.timeline.addEventListener("pointerup", () => { dragging = false; });
el.timeline.addEventListener("pointerleave", () => { if (!dragging) { state.hover = null; el.hint.textContent = hintText(); } });
el.timeline.addEventListener("dblclick", (ev) => {
  if (state.mode !== "heat") return;
  const rect = el.timeline.getBoundingClientRect();
  const g = state.games[Math.floor(tlT(ev.clientX - rect.left))];
  if (g) { el.game.value = g.gameId; setMode("replay"); loadGame(g.gameId); }
});

// court hover
el.court.addEventListener("pointermove", (ev) => {
  const rect = el.court.getBoundingClientRect();
  const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
  const p = view.toCourt(cx, cy);
  let html = null;
  state.hover = null;
  if (state.mode === "heat" && state.view === "hex") {
    const [q, r] = hexKey(p.x, p.y);
    const b = computeBins().map.get(`${q},${r}`);
    if (b) {
      state.hover = { bin: b };
      html = `<b>${b.made}/${b.att}</b> <span class="muted">FG</span> ${pct(b.made, b.att)}<br>` +
        `<span class="muted">每次出手得分</span> ${b.pps.toFixed(2)} PPS<br>` +
        `<span class="muted">距篮筐</span> ~${Math.round(Math.hypot(b.cx, b.cy) / 10)} ft`;
    }
  } else {
    const pool = state.mode === "heat"
      ? state.heatShots.slice(0, state.heatCount)
      : state.events.slice(0, state.shown + 1).filter((e) => e.kind === "fg");
    let best = null, bd = 10;
    for (const s of pool) {
      const d = Math.hypot((view.px(s.x) - cx * view.dpr) / view.dpr, (view.py(s.y) - cy * view.dpr) / view.dpr);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      state.hover = { shot: best };
      html = `<b>${best.made ? "MADE" : "MISS"} · ${best.pts}PT</b><br>${best.action}<br>` +
        `<span class="muted">${fmtDate(best.gameDate)} ${periodName(best.period)} ${mmss(best.remaining)} · ${best.dist} ft</span>`;
    }
  }
  if (html) {
    el.tooltip.innerHTML = html;
    el.tooltip.hidden = false;
    const tw = el.tooltip.offsetWidth, th = el.tooltip.offsetHeight;
    el.tooltip.style.left = `${Math.min(rect.width - tw - 6, cx + 14)}px`;
    el.tooltip.style.top = `${cy + th + 20 > rect.height ? cy - th - 12 : cy + 14}px`;
  } else el.tooltip.hidden = true;
});
el.court.addEventListener("pointerleave", () => { el.tooltip.hidden = true; state.hover = null; });

// buttons
el.play.addEventListener("click", () => (state.playing ? pause() : play()));
el.next.addEventListener("click", stepNext);
el.prev.addEventListener("click", stepPrev);
el.burst.addEventListener("click", nextBurst);
el.speed.addEventListener("change", () => { state.speed[state.mode] = Number(el.speed.value); });
el.sound.addEventListener("click", () => {
  synth.enabled = !synth.enabled;
  el.sound.textContent = synth.enabled ? "🔊" : "🔇";
});
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll("#view-toggle button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
el.game.addEventListener("change", () => {
  if (state.mode !== "replay") setMode("replay");
  loadGame(el.game.value);
});
el.season.addEventListener("change", () => { state.season = el.season.value; state.gameId = null; loadSeason(); });
el.seasonType.addEventListener("change", () => { state.seasonType = el.seasonType.value; state.gameId = null; loadSeason(); });
el.demo.addEventListener("click", () => {
  state.demo = !state.demo;
  state.gameId = null;
  setStatus("");
  updateBadge();
  loadSeason();
});

document.addEventListener("keydown", (ev) => {
  if (ev.target.matches("input, select")) return;
  if (ev.code === "Space") { ev.preventDefault(); state.playing ? pause() : play(); }
  else if (ev.key === "ArrowRight") { ev.preventDefault(); stepNext(); }
  else if (ev.key === "ArrowLeft") { ev.preventDefault(); stepPrev(); }
});

// player search
let searchTimer, searchToken = 0, listItems = [], activeItem = -1;
function showPlayers(list) {
  listItems = list; activeItem = -1;
  el.playerList.innerHTML = list.map((p, i) =>
    `<li role="option" data-i="${i}">${p.name}<small>${p.active ? "现役" : "退役"}</small></li>`).join("");
  el.playerList.hidden = !list.length;
}
function choosePlayer(p) {
  el.playerList.hidden = true;
  state.player = { id: p.id, name: p.name };
  state.gameId = null;
  el.playerInput.value = p.name;
  loadSeason();
}
el.playerInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = el.playerInput.value.trim();
  if (q.length < 2) { showPlayers([]); return; }
  searchTimer = setTimeout(async () => {
    const token = ++searchToken;
    try {
      const list = await api(`/api/players?q=${encodeURIComponent(q)}`);
      if (token === searchToken) showPlayers(list);
    } catch { showPlayers([]); }
  }, 200);
});
el.playerInput.addEventListener("keydown", (ev) => {
  if (el.playerList.hidden) return;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    activeItem = (activeItem + (ev.key === "ArrowDown" ? 1 : -1) + listItems.length) % listItems.length;
    [...el.playerList.children].forEach((li, i) => li.setAttribute("aria-selected", i === activeItem));
  } else if (ev.key === "Enter" && listItems.length) {
    choosePlayer(listItems[Math.max(0, activeItem)]);
  } else if (ev.key === "Escape") el.playerList.hidden = true;
});
el.playerList.addEventListener("click", (ev) => {
  const li = ev.target.closest("li");
  if (li) choosePlayer(listItems[Number(li.dataset.i)]);
});
document.addEventListener("click", (ev) => { if (!ev.target.closest(".field.player")) el.playerList.hidden = true; });

// ------------------------------------------------------------------ boot

for (let y = LATEST_SEASON; y >= FIRST_SEASON; y--) {
  el.season.insertAdjacentHTML("beforeend", `<option>${seasonStr(y)}</option>`);
}
el.season.value = state.season;
el.seasonType.value = state.seasonType;

new ResizeObserver(() => { setupCanvas(); render(); }).observe(el.courtWrap);
setupCanvas();
setMode(state.mode);
setView(state.view);
updateBadge();
requestAnimationFrame(frame);
let backendUp = true;
(async () => {
  if (!state.demo) {
    backendUp = await hasBackend();
    if (!backendUp) fallbackToDemo();
  } else if (location.protocol === "file:") {
    backendUp = false;
    setStatus(STATIC_NOTE);
  }
  loadSeason();
})();
