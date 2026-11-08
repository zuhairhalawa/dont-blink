/**
 * src/renderer/game/corridor.ts
 *
 * Draws one frame of the corridor and the Watcher on a 2D canvas.
 *
 * Everything is procedural: a one-point-perspective corridor lit by a single
 * bare bulb, an original tall figure with a pale blank mask, film grain, a
 * vignette that tightens as the Watcher gets closer, and the eyelids that
 * close across the screen whenever the player blinks.
 *
 * World units: the camera (your eyes) is at x=0, y=0, looking down +z.
 * The floor is at y=+1, the ceiling at y=-1.3, the walls at x=±1.5.
 */

import { CAUGHT_STEP } from './rules';

export interface FrameView {
  /** Canvas size in device pixels. */
  w: number;
  h: number;
  /** Milliseconds, for flicker and grain. */
  time: number;
  /** Watcher position, 0..CAUGHT_STEP (fractional values are allowed). */
  step: number;
  /** 0 = eyes open, 1 = eyelids fully closed. */
  lids: number;
  /** Bulb brightness multiplier on top of the natural flicker (0-1). */
  bulb: number;
  /** Screen shake in pixels. */
  shake: number;
  /** 0-1 red wash (jump scare). */
  redWash: number;
  /** 0-1 white flash (the instant of the jump scare). */
  flash: number;
  /** How the Watcher is standing this time you open your eyes. */
  pose: Pose;
  /** 0 = mouth a thin slit, 1 = torn wide open. */
  mouth: number;
}

/**
 * The Watcher never stands the same way twice: each time it moves, it takes
 * the next pose, so opening your eyes is never predictable.
 */
export interface Pose {
  /** Head roll in radians (negative = toward its right shoulder). */
  tilt: number;
  /** Head offset sideways, world units. */
  headX: number;
  /** Which arm reaches toward you: -1 left, 1 right, 0 none. */
  reach: -1 | 0 | 1;
  /** How far the head drops forward, world units. */
  hunch: number;
}

export const POSES: readonly Pose[] = [
  { tilt: -0.08, headX: 0, reach: 0, hunch: 0 },
  { tilt: 0.42, headX: 0.04, reach: 0, hunch: 0.02 },
  { tilt: -0.5, headX: -0.05, reach: 1, hunch: 0.04 },
  { tilt: 0.12, headX: 0.02, reach: -1, hunch: 0.07 },
  { tilt: -0.95, headX: -0.08, reach: 0, hunch: 0.1 },
  { tilt: 0.62, headX: 0.06, reach: 1, hunch: 0.05 },
  { tilt: 0, headX: 0, reach: -1, hunch: 0.12 },
];

/** The pose for the n-th move of a round. */
export function poseFor(moves: number): Pose {
  return POSES[((moves % POSES.length) + POSES.length) % POSES.length]!;
}

const PALETTE = {
  wall: [58, 46, 33] as const,
  floor: [44, 34, 25] as const,
  ceiling: [36, 30, 24] as const,
  bone: [233, 226, 211] as const,
  bulb: [232, 176, 74] as const,
};

const WALL_X = 1.5;
const FLOOR_Y = 1.0;
const CEIL_Y = -1.3;
const FAR_Z = 34;
const BULB_Z = 3.4;
const BULB_Y = -0.95;
/**
 * Watcher depth for each step, far end to face. The last gap is the largest
 * on purpose: being caught is a sudden lunge, not one more step.
 */
const DEPTHS = [24, 15, 10, 7, 5, 3.6, 2.6, 1.8, 0.4];

/** Depth of the Watcher for a (possibly fractional) step. */
export function watcherDepth(step: number): number {
  const s = Math.max(0, Math.min(CAUGHT_STEP, step));
  const i = Math.min(DEPTHS.length - 2, Math.floor(s));
  const k = s - i;
  return DEPTHS[i]! + (DEPTHS[i + 1]! - DEPTHS[i]!) * k;
}

/**
 * Bulb flicker: mostly steady, with brief irregular dips that come more often
 * the closer the Watcher is (dread 0-1).
 */
export function flicker(time: number, dread = 0): number {
  const s = Math.sin(time * 0.0131) + Math.sin(time * 0.0377 + 1.3) + Math.sin(time * 0.091 + 0.4);
  return s > 2.35 - dread * 1.1 ? 0.3 : 1;
}

/**
 * Light falling on a point at depth z (0 to about 0.65): a pool of light under
 * the bulb that dies quickly into the dark, and almost no ambient light.
 */
function lightAt(z: number, bulb: number): number {
  const d = z - BULB_Z;
  return 0.006 + bulb * 0.65 / (1 + (d * d) / 3.2) * Math.exp(-z / 30);
}

function shade(rgb: readonly number[], l: number): string {
  // Tungsten tint: the lit parts lean toward the bulb colour.
  const r = rgb[0]! * l + PALETTE.bulb[0] * l * 0.35;
  const g = rgb[1]! * l + PALETTE.bulb[1] * l * 0.22;
  const b = rgb[2]! * l + PALETTE.bulb[2] * l * 0.08;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function drawFrame(ctx: CanvasRenderingContext2D, v: FrameView): void {
  const { w, h } = v;
  const bulb = v.bulb * flicker(v.time, Math.min(1, v.step / CAUGHT_STEP));
  const f = h * 0.92;
  const cx = w / 2 + (v.shake ? (Math.random() - 0.5) * v.shake : 0);
  const cy = h * 0.47 + (v.shake ? (Math.random() - 0.5) * v.shake : 0);
  const px = (x: number, z: number) => cx + (x * f) / z;
  const py = (y: number, z: number) => cy + (y * f) / z;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // Corridor: draw depth slices from far to near.
  const slices: number[] = [];
  for (let z = FAR_Z; z > 0.6; z *= 0.88) slices.push(z);
  slices.push(0.55);
  for (let i = 0; i < slices.length - 1; i++) {
    const z0 = slices[i]!;
    const z1 = slices[i + 1]!;
    const l = lightAt((z0 + z1) / 2, bulb);
    // Floor
    quad(ctx, px(-WALL_X, z0), py(FLOOR_Y, z0), px(WALL_X, z0), py(FLOOR_Y, z0),
      px(WALL_X, z1), py(FLOOR_Y, z1), px(-WALL_X, z1), py(FLOOR_Y, z1), shade(PALETTE.floor, l * (i % 2 ? 1 : 0.96)));
    // Ceiling
    quad(ctx, px(-WALL_X, z0), py(CEIL_Y, z0), px(WALL_X, z0), py(CEIL_Y, z0),
      px(WALL_X, z1), py(CEIL_Y, z1), px(-WALL_X, z1), py(CEIL_Y, z1), shade(PALETTE.ceiling, l * 0.8));
    // Walls, with a darker door frame every few slices.
    const door = i % 6 === 2;
    const wallL = l * (door ? 0.45 : 1);
    quad(ctx, px(-WALL_X, z0), py(CEIL_Y, z0), px(-WALL_X, z0), py(FLOOR_Y, z0),
      px(-WALL_X, z1), py(FLOOR_Y, z1), px(-WALL_X, z1), py(CEIL_Y, z1), shade(PALETTE.wall, wallL));
    quad(ctx, px(WALL_X, z0), py(CEIL_Y, z0), px(WALL_X, z0), py(FLOOR_Y, z0),
      px(WALL_X, z1), py(FLOOR_Y, z1), px(WALL_X, z1), py(CEIL_Y, z1), shade(PALETTE.wall, wallL * 0.92));
  }
  // The far end is a black void.
  ctx.fillStyle = '#000';
  ctx.fillRect(px(-WALL_X, FAR_Z), py(CEIL_Y, FAR_Z), (2 * WALL_X * f) / FAR_Z, ((FLOOR_Y - CEIL_Y) * f) / FAR_Z);

  // Whichever is further away is drawn first.
  const wz = watcherDepth(v.step);
  const bulbDraw = () => drawBulb(ctx, px(0, BULB_Z), py(BULB_Y, BULB_Z), py(CEIL_Y, BULB_Z), (f / BULB_Z) * 0.045, bulb);
  if (wz < BULB_Z) bulbDraw();
  drawWatcher(ctx, wz, bulb, px, py, f, v.pose, v.mouth);
  if (wz >= BULB_Z) bulbDraw();

  // Vignette tightens as the Watcher gets closer.
  const dread = Math.min(1, v.step / CAUGHT_STEP);
  const inner = Math.min(w, h) * (0.55 - dread * 0.3);
  const g = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.75 + dread * 0.2})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  drawGrain(ctx, w, h);

  if (v.redWash > 0) {
    ctx.fillStyle = `rgba(179,18,46,${v.redWash * 0.55})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (v.lids > 0) drawLids(ctx, w, h, v.lids);
  if (v.flash > 0) {
    ctx.fillStyle = `rgba(255,250,240,${v.flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function quad(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // A hairline in the same colour hides anti-aliasing seams between slices.
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * The Watcher: a gaunt figure in a long coat, arms hanging to its knees with
 * long fingers, and a pale blank mask at eye level with hollow, stained eyes.
 * It is lit from above by the bulb, so it is a dark shape at the far end and
 * fully visible when close.
 */
function drawWatcher(ctx: CanvasRenderingContext2D, z: number, bulb: number,
  px: (x: number, z: number) => number, py: (y: number, z: number) => number, f: number,
  pose: Pose, mouth: number): void {
  const s = f / z;
  const fx = px(0, z);
  const footY = py(FLOOR_Y, z);
  const l = lightAt(z, bulb);
  // In the final lunge it bends down so the mask ends up level with your eyes.
  const lean = Math.max(0, Math.min(1, (1.8 - z) / (1.8 - 0.4))) * 0.36;
  // Up close the pale mask catches all the light there is.
  const lm = Math.min(1, Math.max(0.1 + l * 1.3, z < 1.5 ? 0.85 : 0));
  drawFigure(ctx, fx, footY + lean * s, s, Math.min(1, l * 1.4), lm, pose, mouth);
}

/** Height of the Watcher from its feet to the top of its mask, in its own units. */
export const FIGURE_HEIGHT = 1.5;
/** Distance from the feet up to the centre of the mask, in its own units. */
export const MASK_CENTRE_UP = 1.33;
/** Height of the mask, in its own units. */
export const MASK_HEIGHT = 0.34;

/**
 * Draw the Watcher with its feet at (fx, footY), `s` pixels per unit.
 * `lit` (0-1) is the light on its body; `lm` (0-1) on its mask.
 */
export function drawFigure(ctx: CanvasRenderingContext2D, fx: number, footY: number, s: number,
  lit: number, lm: number, pose: Pose, mouth: number): void {
  const X = (x: number) => fx + x * s;
  const Y = (y: number) => footY + (y - FLOOR_Y) * s;

  // Light comes from above: shoulders catch it, the hem is lost in the dark.
  const grad = ctx.createLinearGradient(0, Y(-0.1), 0, Y(1.0));
  grad.addColorStop(0, `rgb(${(16 + 70 * lit) | 0},${(13 + 50 * lit) | 0},${(11 + 30 * lit) | 0})`);
  grad.addColorStop(1, 'rgb(6,5,4)');
  ctx.fillStyle = grad;

  // Legs: two thin dark lines under the coat.
  ctx.fillRect(X(-0.07), Y(0.86), 0.035 * s, 0.14 * s);
  ctx.fillRect(X(0.04), Y(0.86), 0.035 * s, 0.14 * s);

  // Coat: hunched shoulders (the right one lower), widening to a ragged hem.
  ctx.beginPath();
  ctx.moveTo(X(-0.05), Y(-0.1));
  ctx.quadraticCurveTo(X(-0.2), Y(-0.08), X(-0.24), Y(0.02));
  ctx.lineTo(X(-0.3), Y(0.88));
  const hem = [-0.3, -0.24, -0.19, -0.12, -0.06, 0.01, 0.08, 0.14, 0.2, 0.26, 0.31];
  hem.forEach((x, i) => ctx.lineTo(X(x), Y(0.88 + (i % 2 ? 0.05 : 0))));
  ctx.lineTo(X(0.25), Y(0.06));
  ctx.quadraticCurveTo(X(0.21), Y(-0.05), X(0.05), Y(-0.1));
  ctx.closePath();
  ctx.fill();

  // Arms hang outside the coat, down past the knees.
  arm(ctx, X, Y, s, -1, lit, pose.reach === -1);
  arm(ctx, X, Y, s, 1, lit, pose.reach === 1);

  // Neck.
  ctx.fillStyle = 'rgb(10,8,7)';
  ctx.fillRect(X(-0.035 + pose.headX / 2), Y(-0.2 + pose.hunch), 0.07 * s, 0.13 * s);

  // Mask, tilted slightly as if listening.
  ctx.save();
  ctx.translate(X(0.005 + pose.headX), Y(-0.33 + pose.hunch));
  ctx.rotate(pose.tilt);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.12 * s, 0.17 * s, 0, 0, Math.PI * 2);
  const mg = ctx.createRadialGradient(-0.02 * s, -0.07 * s, 0.01 * s, 0, 0, 0.19 * s);
  mg.addColorStop(0, shadeBone(lm));
  mg.addColorStop(1, shadeBone(lm * 0.4));
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.clip();

  // Eye holes: jagged, as if cut out by hand, ringed with shadow.
  const holes = [
    { x: -0.047, y: -0.03, r: 0.03, jag: [1, 0.8, 1.15, 0.9, 1.1, 0.75, 1.05, 0.95, 1.2, 0.85] },
    { x: 0.049, y: -0.036, r: 0.028, jag: [0.9, 1.1, 0.8, 1.2, 0.95, 1.05, 0.75, 1.15, 0.9, 1] },
  ];
  for (const hole of holes) {
    const ring = ctx.createRadialGradient(hole.x * s, hole.y * s, hole.r * 0.6 * s, hole.x * s, hole.y * s, hole.r * 2 * s);
    ring.addColorStop(0, 'rgba(20,10,8,0.7)');
    ring.addColorStop(1, 'rgba(20,10,8,0)');
    ctx.fillStyle = ring;
    ctx.fillRect((hole.x - hole.r * 2) * s, (hole.y - hole.r * 2) * s, hole.r * 4 * s, hole.r * 4 * s);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    hole.jag.forEach((k, i) => {
      const a = (i / hole.jag.length) * Math.PI * 2;
      const hx = (hole.x + Math.cos(a) * hole.r * k * 0.8) * s;
      const hy = (hole.y + Math.sin(a) * hole.r * k * 1.25) * s;
      if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    });
    ctx.closePath();
    ctx.fill();
    // A tiny pale pupil deep in each hole, looking straight at you.
    if (s > 60) {
      ctx.fillStyle = `rgba(233,226,211,${Math.min(0.9, 0.3 + lm)})`;
      ctx.beginPath();
      ctx.arc((hole.x + 0.002) * s, (hole.y + 0.004) * s, Math.max(1, 0.0045 * s), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A long crack from the brow to the chin, with two short branches.
  ctx.strokeStyle = `rgba(15,8,6,${0.55 + lm * 0.35})`;
  ctx.lineWidth = Math.max(1, 0.0035 * s);
  ctx.lineJoin = 'miter';
  const crack = [[0.02, -0.17], [0.012, -0.12], [0.022, -0.09], [0.006, -0.05], [0.014, 0.0], [-0.004, 0.05], [0.008, 0.1], [-0.01, 0.17]];
  ctx.beginPath();
  crack.forEach(([cx2, cy2], i) => (i === 0 ? ctx.moveTo(cx2! * s, cy2! * s) : ctx.lineTo(cx2! * s, cy2! * s)));
  ctx.moveTo(0.022 * s, -0.09 * s);
  ctx.lineTo(0.045 * s, -0.11 * s);
  ctx.moveTo(-0.004 * s, 0.05 * s);
  ctx.lineTo(-0.03 * s, 0.065 * s);
  ctx.stroke();

  // The mouth: a thin slit that tears wide open in the lunge.
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (mouth > 0.05) {
    ctx.beginPath();
    ctx.ellipse(-0.002 * s, (0.095 + 0.02 * mouth) * s, (0.035 + 0.012 * mouth) * s, (0.008 + 0.06 * mouth) * s, 0.05, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = Math.max(1, 0.008 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.04 * s, 0.085 * s);
    ctx.quadraticCurveTo(0.0, 0.08 * s, 0.035 * s, 0.095 * s);
    ctx.stroke();
  }
  ctx.restore();
}

/** One arm: upper arm from the shoulder, a long forearm, and four long fingers. */
function arm(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number,
  s: number, side: -1 | 1, lit: number, reach: boolean): void {
  const sx = side * 0.25;
  ctx.strokeStyle = `rgb(${(14 + 45 * lit) | 0},${(11 + 32 * lit) | 0},${(9 + 20 * lit) | 0})`;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, 0.05 * s);
  // A reaching arm rises to chest height and stretches toward you, fingers splayed.
  const hand = reach ? { x: side * 0.5, y: -0.12 } : { x: side * 0.33, y: 0.72 };
  ctx.beginPath();
  ctx.moveTo(X(sx), Y(0.02));
  if (reach) ctx.quadraticCurveTo(X(side * 0.42), Y(0.12), X(hand.x), Y(hand.y));
  else ctx.quadraticCurveTo(X(side * 0.33), Y(0.35), X(hand.x), Y(hand.y));
  ctx.stroke();
  ctx.lineWidth = Math.max(1, 0.012 * s);
  const fingers = [-0.02, -0.005, 0.01, 0.024];
  for (const [i, dx] of fingers.entries()) {
    ctx.beginPath();
    ctx.moveTo(X(hand.x + dx), Y(hand.y));
    if (reach) {
      // Spread out and curling toward the viewer.
      const ang = -0.9 + i * 0.45;
      ctx.quadraticCurveTo(X(hand.x + side * 0.06 + dx), Y(hand.y - 0.05 + i * 0.02),
        X(hand.x + side * 0.11 * Math.cos(ang)), Y(hand.y + 0.1 * Math.sin(ang)));
    } else {
      ctx.quadraticCurveTo(X(hand.x + 0.005 * side + dx * 1.4), Y(hand.y + 0.08), X(hand.x + dx * 1.2), Y(hand.y + 0.18));
    }
    ctx.stroke();
  }
}

function shadeBone(l: number): string {
  const [r, g, b] = PALETTE.bone;
  return `rgb(${(r * l) | 0},${(g * l * 0.97) | 0},${(b * l * 0.9) | 0})`;
}

function drawBulb(ctx: CanvasRenderingContext2D, x: number, y: number, ceilY: number, r: number, bulb: number): void {
  ctx.strokeStyle = '#1a140e';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, ceilY);
  ctx.lineTo(x, y - r);
  ctx.stroke();
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 9);
  halo.addColorStop(0, `rgba(232,176,74,${0.35 * bulb})`);
  halo.addColorStop(1, 'rgba(232,176,74,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 9, y - r * 9, r * 18, r * 18);
  ctx.fillStyle = `rgb(${(120 + 135 * bulb) | 0},${(90 + 130 * bulb) | 0},${(50 + 120 * bulb) | 0})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(255,240,220,0.05)';
  for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
}

/** Upper and lower eyelids closing toward the middle, with a warm inner glow. */
export function drawLids(ctx: CanvasRenderingContext2D, w: number, h: number, k: number): void {
  const reach = (h / 2) * Math.min(1, k) * 1.08;
  ctx.fillStyle = '#050304';
  // Upper lid: its lower edge curves down in the middle.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, reach * 0.55);
  ctx.quadraticCurveTo(w / 2, reach * 1.45, 0, reach * 0.55);
  ctx.closePath();
  ctx.fill();
  // Lower lid.
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, h);
  ctx.lineTo(w, h - reach * 0.55);
  ctx.quadraticCurveTo(w / 2, h - reach * 1.45, 0, h - reach * 0.55);
  ctx.closePath();
  ctx.fill();
  // Light through closed eyelids looks red.
  if (k > 0.6) {
    ctx.fillStyle = `rgba(90,8,16,${(k - 0.6) * 1.2})`;
    ctx.fillRect(0, 0, w, h);
  }
}
