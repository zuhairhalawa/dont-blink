/**
 * src/renderer/game/room.ts
 *
 * "It's in your room": the play screen is the player's own webcam image,
 * graded like a night-time security camera, with the Watcher standing in
 * the room behind them. Each blink brings it closer, until it is right over
 * the player's shoulder. The player is cut out with a person mask and drawn
 * in front, so the Watcher really looks like it is behind them.
 *
 * Nothing here is recorded or sent anywhere; frames are drawn and dropped.
 */

import { CAUGHT_STEP } from './rules';
import { drawFigure, drawGrain, drawLids, MASK_CENTRE_UP, MASK_HEIGHT, type Pose } from './corridor';
import type { Sprites, SpriteName } from './sprites';

/** Face position on screen, normalised 0-1, already mirrored like the picture. */
export interface ScreenFace { cx: number; cy: number; w: number; h: number }

export interface Placement {
  /** Feet position in pixels, and pixels per figure unit. */
  fx: number;
  footY: number;
  s: number;
  /** Which side of the player it approaches from. */
  side: -1 | 1;
  /** Distance from the camera in metres (0 during the lunge). */
  depth: number;
}

/**
 * Distance from the camera, in metres, for each step. Steps 0-5 are spread
 * across the room; 6 and 7 are right behind the player's shoulder (the
 * player sits about 0.6 m from a laptop webcam).
 */
export const STEP_DEPTHS = [4.2, 3.4, 2.7, 2.15, 1.7, 1.35, 1.0, 0.85];
/** Sideways spot (metres from the player's side) for each step, so every step lands somewhere new. */
const STEP_SIDE = [1.25, 0.8, 1.15, 0.7, 1.0, 0.65, 0.42, 0.38];
/** Webcam assumptions: about 70 degrees across, lens 1.1 m above the floor. */
const HFOV_DEG = 70;
const CAMERA_HEIGHT = 1.1;
/** Mask size in metres. */
const MASK_M = 0.25;

/** Height of the Watcher's mask above the floor: tall far away, stooping as it closes in. */
export function maskHeightAt(depth: number): number {
  const t = Math.max(0, Math.min(1, (depth - 1.3) / (3 - 1.3)));
  return 1.2 + (1.85 - 1.2) * t;
}

/**
 * Where to draw the Watcher for a (fractional) step, using a simple pinhole
 * camera, so its size, its height in the frame and its feet on the floor all
 * change the way a real person's would walking toward a webcam.
 *
 *   steps 0-5:  standing in the room, further to the side the further away,
 *               in a different spot each step
 *   steps 6-7:  right behind the player's shoulder, its mask beside their head
 *   step 8:     the lunge; its mask fills the middle of the screen
 */
export function placeWatcher(step: number, face: ScreenFace | null, w: number, h: number): Placement {
  const f = face ?? { cx: 0.5, cy: 0.45, w: 0.2, h: 0.28 };
  const side: -1 | 1 = f.cx > 0.5 ? -1 : 1;
  const focal = w / 2 / Math.tan(((HFOV_DEG / 2) * Math.PI) / 180);
  // The horizon sits at the player's eye line (their eyes are near lens height).
  const horizon = (f.cy - f.h * 0.12) * h;
  const centreX = f.cx * w;

  const k = Math.max(0, Math.min(CAUGHT_STEP, step));
  const at = (i: number) => {
    const d = STEP_DEPTHS[i]!;
    if (i >= 6) {
      // Behind the shoulder: mask beside and a little above the player's head.
      const mask = f.h * h * (i === 6 ? 1.0 : 1.3);
      return { x: (f.cx + side * f.w * (i === 6 ? 1.2 : 0.95)) * w, y: (f.cy - f.h * 0.3) * h, mask, d };
    }
    const mask = (focal * MASK_M) / d;
    const x = centreX + (focal * side * STEP_SIDE[i]!) / d;
    const y = horizon - (focal * (maskHeightAt(d) - CAMERA_HEIGHT)) / d;
    return { x, y, mask, d };
  };

  let x: number, y: number, mask: number, depth: number;
  if (k <= CAUGHT_STEP - 1) {
    const i = Math.floor(k);
    const a = at(i);
    const b = at(Math.min(CAUGHT_STEP - 1, i + 1));
    const t = k - i;
    x = a.x + (b.x - a.x) * t;
    y = a.y + (b.y - a.y) * t;
    mask = a.mask + (b.mask - a.mask) * t;
    depth = a.d + (b.d - a.d) * t;
  } else {
    const a = at(CAUGHT_STEP - 1);
    const t = k - (CAUGHT_STEP - 1);
    x = a.x + (0.5 * w - a.x) * t;
    y = a.y + (0.5 * h - a.y) * t;
    mask = a.mask + (1.25 * h - a.mask) * t;
    depth = a.d * (1 - t);
  }
  // Keep it inside the picture horizontally.
  x = Math.max(mask * 0.6, Math.min(w - mask * 0.6, x));
  const s = mask / MASK_HEIGHT;
  return { fx: x, footY: y + MASK_CENTRE_UP * s, s, side, depth };
}

export interface RoomView {
  w: number;
  h: number;
  time: number;
  /** The live camera picture (not mirrored; this function mirrors it). */
  video: HTMLVideoElement;
  /** Person mask from PersonMask (not mirrored), or null to skip the cut-out. */
  mask: HTMLCanvasElement | null;
  face: ScreenFace | null;
  step: number;
  lids: number;
  /** Room brightness 0-1 (dips for the flicker and blackouts). */
  bright: number;
  shake: number;
  redWash: number;
  flash: number;
  pose: Pose;
  /** Which pose this is (moves so far), to pick a photo pose. */
  poseIndex: number;
  mouth: number;
  /** Photo-real Watcher images, if generated; otherwise it is drawn. */
  sprites?: Sprites;
  /**
   * Privacy mode: blur the player's face in everything drawn (the tracking
   * still reads the clear camera). The Watcher stays sharp.
   */
  hideFace?: boolean;
}

export const FULL_BODY: SpriteName[] = ['watcher-stand', 'watcher-tilt', 'watcher-reach', 'watcher-hunch'];

/**
 * Draw a photo pose sized from the placement's mask height, or return false
 * so the drawn Watcher is used. Proportions measured on the generated images:
 * in the full-body shots the mask is about a tenth of the figure's height,
 * with its centre 7% from the top; the leaning shot is mostly mask (its
 * centre a third of the way down); the scream close-up is the mask.
 */
export function drawSprite(ctx: CanvasRenderingContext2D, v: RoomView, p: Placement, lunging: boolean): boolean {
  const sp = v.sprites;
  if (!sp) return false;
  const maskPx = p.s * MASK_HEIGHT;
  const maskY = p.footY - MASK_CENTRE_UP * p.s;
  let img: HTMLCanvasElement | undefined;
  let height: number;
  let top: number;
  let flip = false;
  if (lunging) {
    img = sp['watcher-scream'];
    height = maskPx * 1.05;
    top = maskY - height / 2;
  } else if (v.step >= 5.5 && sp['watcher-lean']) {
    img = sp['watcher-lean'];
    height = maskPx * 1.6;
    top = maskY - height * 0.33;
    // The photo leans to the right; mirror it when it comes from the right.
    flip = p.side === 1;
  } else {
    img = sp[FULL_BODY[v.poseIndex % FULL_BODY.length]!] ?? sp['watcher-stand'];
    height = maskPx * 9.6;
    top = maskY - height * 0.07;
  }
  if (!img) return false;
  const width = (height * img.width) / img.height;
  if (flip) {
    ctx.save();
    ctx.translate(p.fx, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -width / 2, top, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(img, p.fx - width / 2, top, width, height);
  }
  return true;
}

let room: HTMLCanvasElement | null = null;
let cut: HTMLCanvasElement | null = null;
let tmp: HTMLCanvasElement | null = null;
/** Blur a whole canvas in place (used when the face can't be located). */
function blurAll(g: CanvasRenderingContext2D, strength: number): void {
  const { width: w, height: h } = g.canvas;
  tmp = canvasOf(tmp, w, h);
  const t = tmp.getContext('2d')!;
  t.clearRect(0, 0, w, h);
  t.drawImage(g.canvas, 0, 0);
  g.save();
  g.filter = `blur(${strength}px)`;
  g.drawImage(tmp, 0, 0);
  g.restore();
}

let sil: HTMLCanvasElement | null = null;
let grown: HTMLCanvasElement | null = null;

/** The player's shape from the person mask, filled with a soft near-black. */
function silhouette(mask: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  sil = canvasOf(sil, w, h);
  const g = sil.getContext('2d')!;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  // Grow the mask by a pixel in every direction at its own small size (cheap),
  // so hair and ears stay covered; scaling it up keeps the edge soft.
  grown = canvasOf(grown, mask.width, mask.height);
  const m = grown.getContext('2d')!;
  m.clearRect(0, 0, mask.width, mask.height);
  for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
    m.drawImage(mask, ox, oy);
  }
  drawCoverMirrored(g, grown, mask.width, mask.height, w, h);
  g.globalCompositeOperation = 'source-in';
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a1614');
  grad.addColorStop(1, '#0b0908');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return sil;
}



function canvasOf(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const out = c ?? document.createElement('canvas');
  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }
  return out;
}

/** Draw `src` mirrored so it covers a w x h canvas, like a selfie view. */
function drawCoverMirrored(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number,
  w: number, h: number): void {
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Map a face box in camera coordinates (0-1, not mirrored) to screen coordinates. */
export function faceToScreen(face: { cx: number; cy: number; w: number; h: number },
  vw: number, vh: number, w: number, h: number): ScreenFace {
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;
  const x = ox + (1 - face.cx) * dw;
  const y = oy + face.cy * dh;
  return { cx: x / w, cy: y / h, w: (face.w * dw) / w, h: (face.h * dh) / h };
}

export function drawRoom(ctx: CanvasRenderingContext2D, v: RoomView): void {
  const { w, h, video } = v;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (video.readyState < 2 || !video.videoWidth) return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  room = canvasOf(room, w, h);
  const r = room.getContext('2d')!;
  r.globalCompositeOperation = 'source-over';
  drawCoverMirrored(r, video, vw, vh, w, h);

  const lunging = v.step > CAUGHT_STEP - 1;
  const behind = !lunging && v.mask !== null;

  // Privacy mode: the player becomes a soft dark silhouette, cut from the
  // person mask, so no face shows whichever way they turn (play-test: a
  // face-tracked blur looked like a grey bubble and leaked a profile). Under
  // a mask yet, the whole picture is blurred.
  let shadow: HTMLCanvasElement | null = null;
  if (v.hideFace) {
    if (v.mask) {
      shadow = silhouette(v.mask, w, h);
    } else {
      blurAll(r, Math.max(28, w / 40));
    }
  }

  // The Watcher, standing in the room.
  const p = placeWatcher(v.step, v.face, w, h);
  // In the lunge it is in front of the player, so the shadow goes first.
  if (lunging && shadow) {
    r.drawImage(shadow, 0, 0);
    r.drawImage(shadow, 0, 0);
  }
  // Soften it into the picture: a faint shadow at its feet, a slight blur and
  // a touch of transparency, so it sits in the room instead of on top of it.
  if (!lunging) {
    const sh = r.createRadialGradient(p.fx, p.footY, 0, p.fx, p.footY, p.s * 0.45);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    r.fillStyle = sh;
    r.fillRect(p.fx - p.s * 0.45, p.footY - p.s * 0.12, p.s * 0.9, p.s * 0.24);
  }
  r.save();
  // Distance shading: darker far away, lit up close. (No per-frame blur: full-
  // screen canvas blurs starved the Presage SDK of CPU.)
  const near = Math.max(0, Math.min(1, (4.2 - p.depth) / 3.2));
  r.filter = `brightness(${(0.6 + near * 0.45).toFixed(2)})`;
  // A faint breathing sway, so it looks alive while it waits.
  const q = lunging ? p : {
    ...p,
    s: p.s * (1 + 0.012 * Math.sin(v.time / 900)),
    fx: p.fx + p.s * 0.012 * Math.sin(v.time / 1300),
  };
  if (!drawSprite(r, v, q, lunging)) {
    drawFigure(r, q.fx, q.footY, q.s, 0.55, lunging ? 0.95 : 0.78, v.pose, v.mouth);
  }
  r.restore();

  // The player in front of it: cut out of the camera picture with the mask
  // (or their silhouette, in privacy mode).
  if (behind && v.mask && !shadow) {
    cut = canvasOf(cut, w, h);
    const c = cut.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    drawCoverMirrored(c, video, vw, vh, w, h);
    c.globalCompositeOperation = 'destination-in';
    drawCoverMirrored(c, v.mask, v.mask.width, v.mask.height, w, h);
    c.globalCompositeOperation = 'source-over';
  }
  const front = behind ? (shadow ?? (v.mask ? cut : null)) : null;

  // Normal camera colours (play-test: a dark grey grade hid the Watcher
  // against dark corners). Only the light dips for flicker and blackouts.
  const dread = Math.min(1, v.step / CAUGHT_STEP);
  const dx = v.shake ? (Math.random() - 0.5) * v.shake : 0;
  const dy = v.shake ? (Math.random() - 0.5) * v.shake : 0;
  ctx.save();
  if (v.bright < 0.999) ctx.filter = `brightness(${Math.max(0.08, v.bright)})`;
  ctx.drawImage(room, dx, dy);
  if (front) {
    ctx.drawImage(front, dx, dy);
    // Twice for the silhouette, so its soft edges are solid enough.
    if (front === shadow) ctx.drawImage(front, dx, dy);
  }
  ctx.restore();

  // A light vignette that tightens as it gets closer.
  const inner = Math.min(w, h) * (0.6 - dread * 0.25);
  const g = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.25 + dread * 0.35})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  drawGrain(ctx, w, h);

  if (v.redWash > 0) {
    ctx.fillStyle = `rgba(179,18,46,${v.redWash * 0.5})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (v.lids > 0) drawLids(ctx, w, h, v.lids);
  if (v.flash > 0) {
    ctx.fillStyle = `rgba(255,250,240,${v.flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}
