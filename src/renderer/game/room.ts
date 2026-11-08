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
}

/**
 * Where to draw the Watcher for a (fractional) step.
 *
 *   step 0:  standing small in the background, on the side of the room with
 *            more space
 *   step 7:  looming just behind the player's shoulder, its mask a little
 *            above and beside their face, larger than their head
 *   step 8:  the lunge; its mask fills the middle of the screen
 */
export function placeWatcher(step: number, face: ScreenFace | null, w: number, h: number): Placement {
  const f = face ?? { cx: 0.5, cy: 0.45, w: 0.2, h: 0.28 };
  const side: -1 | 1 = f.cx > 0.5 ? -1 : 1;

  // Mask centre and mask height (px) at the far end...
  const far = { x: (side === -1 ? 0.13 : 0.87) * w, y: 0.42 * h, mask: 0.06 * h };
  // ...and right behind the shoulder.
  const near = {
    x: (f.cx + side * f.w * 0.95) * w,
    y: (f.cy - f.h * 0.3) * h,
    mask: f.h * h * 1.25,
  };
  // The lunge: centred, mask taller than the screen.
  const lunge = { x: 0.5 * w, y: 0.5 * h, mask: 1.25 * h };

  const k = Math.max(0, Math.min(CAUGHT_STEP, step));
  let x: number, y: number, mask: number;
  if (k <= CAUGHT_STEP - 1) {
    const t = k / (CAUGHT_STEP - 1);
    // Size grows geometrically, so each step feels like the same jump closer.
    mask = far.mask * Math.pow(near.mask / far.mask, t);
    const e = t * t * (3 - 2 * t);
    x = far.x + (near.x - far.x) * e;
    y = far.y + (near.y - far.y) * e;
  } else {
    const t = k - (CAUGHT_STEP - 1);
    mask = near.mask + (lunge.mask - near.mask) * t;
    x = near.x + (lunge.x - near.x) * t;
    y = near.y + (lunge.y - near.y) * t;
  }
  const s = mask / MASK_HEIGHT;
  return { fx: x, footY: y + MASK_CENTRE_UP * s, s, side };
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
}

const FULL_BODY: SpriteName[] = ['watcher-stand', 'watcher-tilt', 'watcher-reach', 'watcher-hunch'];

/**
 * Draw a photo pose sized from the placement's mask height, or return false
 * so the drawn Watcher is used. Heights are relative to the mask: a full-body
 * photo is about 7.5 masks tall, the leaning shot about 3, the scream close-up 1.5.
 */
function drawSprite(ctx: CanvasRenderingContext2D, v: RoomView, p: Placement, lunging: boolean): boolean {
  const sp = v.sprites;
  if (!sp) return false;
  const maskPx = p.s * MASK_HEIGHT;
  const maskY = p.footY - MASK_CENTRE_UP * p.s;
  let img: HTMLCanvasElement | undefined;
  let height: number;
  let top: number;
  if (lunging) {
    img = sp['watcher-scream'];
    height = maskPx * 1.5;
    top = maskY - height / 2;
  } else if (v.step >= 5.5 && sp['watcher-lean']) {
    img = sp['watcher-lean'];
    height = maskPx * 3;
    top = maskY - maskPx * 0.75;
  } else {
    img = sp[FULL_BODY[v.poseIndex % FULL_BODY.length]!] ?? sp['watcher-stand'];
    height = maskPx * 7.5;
    top = maskY - maskPx * 0.6;
  }
  if (!img) return false;
  const width = (height * img.width) / img.height;
  ctx.drawImage(img, p.fx - width / 2, top, width, height);
  return true;
}

let room: HTMLCanvasElement | null = null;
let cut: HTMLCanvasElement | null = null;

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

  // The Watcher, standing in the room.
  const p = placeWatcher(v.step, v.face, w, h);
  const lunging = v.step > CAUGHT_STEP - 1;
  const behind = !lunging && v.mask !== null;
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
  r.filter = `blur(${Math.max(0.6, Math.min(2.2, p.s / 400))}px)`;
  r.globalAlpha = lunging ? 1 : 0.9;
  if (!drawSprite(r, v, p, lunging)) {
    drawFigure(r, p.fx, p.footY, p.s, 0.55, lunging ? 0.95 : 0.78, v.pose, v.mouth);
  }
  r.restore();

  // The player in front of it: cut out of the camera picture with the mask.
  if (behind && v.mask) {
    cut = canvasOf(cut, w, h);
    const c = cut.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    drawCoverMirrored(c, video, vw, vh, w, h);
    c.globalCompositeOperation = 'destination-in';
    drawCoverMirrored(c, v.mask, v.mask.width, v.mask.height, w, h);
    c.globalCompositeOperation = 'source-over';
  }

  // Night security-camera grade over everything.
  const dread = Math.min(1, v.step / CAUGHT_STEP);
  const dx = v.shake ? (Math.random() - 0.5) * v.shake : 0;
  const dy = v.shake ? (Math.random() - 0.5) * v.shake : 0;
  ctx.save();
  ctx.filter = `grayscale(1) sepia(0.3) brightness(${(behind ? 0.5 - dread * 0.12 : 0.7) * v.bright}) contrast(1.5)`;
  ctx.drawImage(room, dx, dy);
  // The player stays readable: muted colour at nearly normal brightness, so
  // their eyes and expression show (the full grade made their eyes vanish).
  if (behind && cut) {
    ctx.filter = `grayscale(0.55) sepia(0.2) brightness(${0.95 * Math.max(0.35, v.bright)}) contrast(1.1)`;
    ctx.drawImage(cut, dx, dy);
  }
  ctx.restore();

  // Rolling scan line, like an old camera.
  const scanY = ((v.time / 9) % (h + 80)) - 40;
  const sg = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, scanY - 40, w, 80);

  // Vignette tightens as it gets closer.
  const inner = Math.min(w, h) * (0.5 - dread * 0.28);
  const g = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.7 + dread * 0.25})`);
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
