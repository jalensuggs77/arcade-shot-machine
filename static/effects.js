// Arcade juice: the full-screen "ON FIRE" flame border, court particles,
// banner pop-ups, screen shake and a tiny WebAudio synth.

// ---------------------------------------------------------------- flames

export class FireBorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.target = 0;      // 0 = off, 1 = heating up, 2 = on fire
    this.level = 0;       // eased towards target
    this.parts = [];
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
  }

  set(level) { this.target = level; }

  spawn(n) {
    const W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    for (let i = 0; i < n; i++) {
      const edge = Math.random();
      let x, y, vx, vy;
      // Bottom edge gets the most flames, sides lick upwards, top hangs down.
      if (edge < 0.4) { x = Math.random() * W; y = H + 10 * d; vx = (Math.random() - 0.5) * 0.6; vy = -(2 + Math.random() * 3); }
      else if (edge < 0.65) { x = -5 * d; y = Math.random() * H; vx = 0.6 + Math.random(); vy = -(1.5 + Math.random() * 2); }
      else if (edge < 0.9) { x = W + 5 * d; y = Math.random() * H; vx = -(0.6 + Math.random()); vy = -(1.5 + Math.random() * 2); }
      else { x = Math.random() * W; y = -5 * d; vx = (Math.random() - 0.5); vy = 0.8 + Math.random(); }
      this.parts.push({ x, y, vx: vx * d, vy: vy * d, life: 1, size: (14 + Math.random() * 26) * d });
    }
  }

  tick(dt) {
    this.level += (this.target - this.level) * Math.min(1, dt * 4);
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.level < 0.02 && !this.parts.length) return;

    const rate = this.level > 1.2 ? 9 : this.level > 0.4 ? 2 : 0;
    this.spawn(Math.round(rate * this.level * dt * 60));

    ctx.globalCompositeOperation = "lighter";
    const decay = dt * 1.6;
    this.parts = this.parts.filter((p) => (p.life -= decay) > 0);
    for (const p of this.parts) {
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vx += (Math.random() - 0.5) * 0.3 * this.dpr;
      const r = p.size * (0.4 + p.life * 0.6);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      // white-hot core -> yellow -> orange -> transparent red
      g.addColorStop(0, `rgba(255,255,220,${0.9 * p.life})`);
      g.addColorStop(0.25, `rgba(255,210,60,${0.7 * p.life})`);
      g.addColorStop(0.6, `rgba(255,90,20,${0.45 * p.life})`);
      g.addColorStop(1, "rgba(180,20,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // A pulsing inner glow frame so the border reads even between particles.
    if (this.level > 0.05) {
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 120);
      const a = Math.min(1, this.level / 2) * pulse;
      const w = 28 * this.dpr;
      const W = canvas.width, H = canvas.height;
      const edges = [
        [0, 0, 0, w, 0, 0, W, w], [0, H, 0, H - w, 0, H - w, W, w],
        [0, 0, w, 0, 0, 0, w, H], [W, 0, W - w, 0, W - w, 0, w, H],
      ];
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgba(255,110,20,${0.8 * a})`);
        g.addColorStop(1, "rgba(255,60,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
  }
}

// ---------------------------------------------------------------- particles

export class Particles {
  constructor() { this.list = []; }

  burst(x, y, { n = 24, colors = ["#ffe066", "#ff8c1a", "#ffffff"], speed = 4, life = 0.9, size = 3 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random());
      this.list.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life,
        size: size * (0.6 + Math.random()), color: colors[i % colors.length], kind: "dot",
      });
    }
  }

  ring(x, y, color = "#3df5ff", maxR = 40) {
    this.list.push({ x, y, life: 0.6, max: 0.6, color, kind: "ring", maxR });
  }

  text(x, y, str, color = "#ffe066", size = 18) {
    this.list.push({ x, y, vy: -0.8, life: 1.2, max: 1.2, color, kind: "text", str, size });
  }

  tick(ctx, dt, dpr) {
    this.list = this.list.filter((p) => (p.life -= dt) > 0);
    for (const p of this.list) {
      const k = p.life / p.max;
      ctx.globalAlpha = Math.max(0, k);
      if (p.kind === "dot") {
        p.x += p.vx * dt * 60 * dpr; p.y += p.vy * dt * 60 * dpr; p.vy += 0.12 * dt * 60;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size * dpr / 2, p.y - p.size * dpr / 2, p.size * dpr, p.size * dpr);
      } else if (p.kind === "ring") {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * dpr * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.maxR * dpr * (1 - k) + 4, 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === "text") {
        p.y += p.vy * dt * 60 * dpr;
        ctx.font = `${p.size * dpr}px "Press Start 2P", monospace`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#000"; ctx.fillText(p.str, p.x + 2 * dpr, p.y + 2 * dpr);
        ctx.fillStyle = p.color; ctx.fillText(p.str, p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- banners

export function banner(el, text, cls = "") {
  const node = document.createElement("div");
  node.className = `banner ${cls}`;
  node.textContent = text;
  el.appendChild(node);
  node.addEventListener("animationend", () => node.remove());
}

export function shake(el, strength = "") {
  el.classList.remove("shake", "shake-big");
  void el.offsetWidth; // restart the animation
  el.classList.add(strength === "big" ? "shake-big" : "shake");
}

// ---------------------------------------------------------------- sound

export class Synth {
  constructor() { this.enabled = true; this.ctx = null; }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  tone(freq, dur, { type = "square", vol = 0.06, slide = 0, delay = 0 } = {}) {
    if (!this.enabled) return;
    const ac = this.ensure(); if (!ac) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  noise(dur, { vol = 0.08, freq = 3000, delay = 0 } = {}) {
    if (!this.enabled) return;
    const ac = this.ensure(); if (!ac) return;
    const t0 = ac.currentTime + delay;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t0);
  }

  swish(pts) {
    this.noise(0.25, { freq: 4500, vol: 0.12 });
    this.tone(pts === 3 ? 880 : 660, 0.12, { delay: 0.05 });
    if (pts === 3) this.tone(1320, 0.15, { delay: 0.14 });
  }
  brick() { this.tone(140, 0.18, { type: "triangle", vol: 0.12, slide: -80 }); }
  ft(made) { made ? this.tone(990, 0.08, { vol: 0.04 }) : this.tone(200, 0.1, { vol: 0.05 }); }
  heating() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.1, { delay: i * 0.07 })); }
  fire() {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { delay: i * 0.06, vol: 0.07 }));
    this.noise(0.8, { freq: 800, vol: 0.1, delay: 0.1 });
  }
  cool() { this.tone(400, 0.4, { type: "sawtooth", vol: 0.05, slide: -300 }); }
}
