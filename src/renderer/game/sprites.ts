/**
 * src/renderer/game/sprites.ts
 *
 * Photo-real Watcher images (generated separately on a flat green background;
 * prompts in assets/watcher-src/PROMPTS.md). At startup each image is
 * chroma-keyed: the green becomes transparent, green fringe on the edges is
 * removed, and the image is cropped to the figure. Missing images are simply
 * skipped and the drawn Watcher is used instead.
 */

export const SPRITE_NAMES = [
  'watcher-stand', 'watcher-tilt', 'watcher-reach', 'watcher-hunch', 'watcher-lean', 'watcher-scream',
] as const;
export type SpriteName = (typeof SPRITE_NAMES)[number];
export type Sprites = Partial<Record<SpriteName, HTMLCanvasElement>>;

/**
 * Alpha for one pixel: 0 for clearly green background, 1 for the figure,
 * a soft ramp in between. "Greenness" is how much green beats red and blue.
 */
export function keyAlpha(r: number, g: number, b: number): number {
  const greenness = g - Math.max(r, b);
  if (greenness <= 30) return 1;
  if (greenness >= 90) return 0;
  return 1 - (greenness - 30) / 60;
}

/** Remove green spill from an edge pixel: green may not exceed the brighter of red and blue. */
export function despill(r: number, g: number, b: number): number {
  return Math.min(g, Math.max(r, b));
}

/** Chroma-key an image into a cropped canvas with transparency. */
export function keyImage(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const px = data.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = keyAlpha(px[i]!, px[i + 1]!, px[i + 2]!);
      px[i + 1] = despill(px[i]!, px[i + 1]!, px[i + 2]!);
      px[i + 3] = Math.round(a * 255);
      if (a > 0.5) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  g.putImageData(data, 0, 0);
  if (x1 < 0) return c;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Fade the edges where a photo is cropped through the body (the leaning shot
 * is cut at its bottom and left), so it dissolves into the dark instead of
 * ending in a straight line. Fractions are of width and height.
 */
export function fadeEdges(c: HTMLCanvasElement, edges: { bottom?: number; left?: number }): void {
  const g = c.getContext('2d')!;
  g.save();
  g.globalCompositeOperation = 'destination-in';
  if (edges.bottom) {
    const y0 = c.height * (1 - edges.bottom);
    const grad = g.createLinearGradient(0, y0, 0, c.height);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  }
  if (edges.left) {
    const x1 = c.width * edges.left;
    const grad = g.createLinearGradient(0, 0, x1, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.restore();
}

/** Load and key every image that exists; quietly skip the rest. */
export async function loadSprites(load: (name: SpriteName) => Promise<Uint8Array>): Promise<Sprites> {
  const out: Sprites = {};
  await Promise.all(SPRITE_NAMES.map(async (name) => {
    try {
      const bytes = await load(name);
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const keyed = keyImage(bmp);
      bmp.close();
      if (name === 'watcher-lean') fadeEdges(keyed, { bottom: 0.35, left: 0.2 });
      out[name] = keyed;
    } catch {
      // Not generated yet: the drawn Watcher stands in.
    }
  }));
  return out;
}
