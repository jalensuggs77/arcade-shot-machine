// Half-court geometry in NBA shot-chart units: tenths of a foot, rim at (0,0),
// x runs sideline to sideline (-250..250), y runs from the baseline (-47.5)
// out to half court (422.5). The rim is drawn at the top of the canvas.

export const COURT = { minX: -250, maxX: 250, minY: -47.5, maxY: 422.5 };
export const COURT_W = COURT.maxX - COURT.minX;
export const COURT_H = COURT.maxY - COURT.minY;

const THREE_R = 237.5;
const CORNER_X = 220;
const CORNER_Y = Math.sqrt(THREE_R ** 2 - CORNER_X ** 2); // ~89.5

export function makeView(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = cssW * (COURT_H / COURT_W);
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const s = (cssW / COURT_W) * dpr;
  return {
    canvas, dpr, s, cssW, cssH,
    px: (x) => (x - COURT.minX) * s,
    py: (y) => (y - COURT.minY) * s,
    // screen (css px) -> court units
    toCourt: (cx, cy) => ({ x: cx * dpr / s + COURT.minX, y: cy * dpr / s + COURT.minY }),
  };
}

export function drawCourt(ctx, v, { line = "#3df5ff", floor = "#120a2a", glow = 8 } = {}) {
  const { px, py, s } = v;
  ctx.save();
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, v.canvas.width, v.canvas.height);

  // faint floor grid for the retro look
  ctx.strokeStyle = "rgba(120, 90, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let x = COURT.minX; x <= COURT.maxX; x += 25) {
    ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), v.canvas.height); ctx.stroke();
  }
  for (let y = COURT.minY; y <= COURT.maxY; y += 25) {
    ctx.beginPath(); ctx.moveTo(0, py(y)); ctx.lineTo(v.canvas.width, py(y)); ctx.stroke();
  }

  ctx.strokeStyle = line;
  ctx.lineWidth = 2 * v.dpr;
  ctx.shadowColor = line;
  ctx.shadowBlur = glow * v.dpr;

  const arc = (cx, cy, r, a0, a1, ccw = false) => {
    ctx.beginPath(); ctx.arc(px(cx), py(cy), r * s, a0, a1, ccw); ctx.stroke();
  };
  const seg = (x0, y0, x1, y1) => {
    ctx.beginPath(); ctx.moveTo(px(x0), py(y0)); ctx.lineTo(px(x1), py(y1)); ctx.stroke();
  };
  const rect = (x0, y0, x1, y1) => {
    ctx.strokeRect(px(x0), py(y0), (x1 - x0) * s, (y1 - y0) * s);
  };

  rect(COURT.minX, COURT.minY, COURT.maxX, COURT.maxY);      // boundary
  rect(-80, -47.5, 80, 142.5);                                 // paint
  rect(-60, -47.5, 60, 142.5);                                 // inner lane
  arc(0, 142.5, 60, 0, Math.PI);                               // FT circle, outer half
  ctx.setLineDash([10 * v.dpr, 8 * v.dpr]);
  arc(0, 142.5, 60, Math.PI, 2 * Math.PI);                     // FT circle, dashed half
  ctx.setLineDash([]);
  arc(0, 0, 40, 0, Math.PI);                                   // restricted area
  seg(-30, -7.5, 30, -7.5);                                    // backboard
  arc(0, 0, 7.5, 0, 2 * Math.PI);                              // rim

  // three-point line: corners + arc
  seg(-CORNER_X, -47.5, -CORNER_X, CORNER_Y);
  seg(CORNER_X, -47.5, CORNER_X, CORNER_Y);
  const a = Math.atan2(CORNER_Y, CORNER_X);
  arc(0, 0, THREE_R, a, Math.PI - a);

  // centre circle (half of it lives on this side)
  arc(0, 422.5, 60, Math.PI, 2 * Math.PI);
  arc(0, 422.5, 20, Math.PI, 2 * Math.PI);
  ctx.restore();
}

export const RIM = { x: 0, y: 0 };
