// Image clean-up before OCR, on plain pixel arrays (no canvas), so it runs in the browser and in tests.
//
// Phone photos of documents have shadows and uneven light. Tesseract binarizes with one global
// (Otsu) threshold, which loses text in the darker corner. An adaptive threshold (Bradley-Roth:
// a pixel is ink when it is darker than the mean of its neighbourhood by k) handles that, and an
// integral image keeps it O(pixels) whatever the window size.

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) {
    data[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return { width, height, data };
}

export function grayToRgba(g: GrayImage): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(g.data.length * 4);
  for (let j = 0, i = 0; j < g.data.length; j++, i += 4) {
    out[i] = out[i + 1] = out[i + 2] = g.data[j];
    out[i + 3] = 255;
  }
  return out;
}

/** Otsu's threshold: the gray level that maximizes the variance between the two classes. */
export function otsuThreshold(g: GrayImage): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** Light text on a dark background (more than half the pixels on the dark side of Otsu). */
export function isDarkBackground(g: GrayImage): boolean {
  const t = otsuThreshold(g);
  let dark = 0;
  for (const v of g.data) if (v <= t) dark++;
  return dark > g.data.length / 2;
}

export function invert(g: GrayImage): GrayImage {
  const data = new Uint8ClampedArray(g.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 255 - g.data[i];
  return { ...g, data };
}

export interface BinarizeOptions {
  /** Window side in pixels; default 1/16 of the smaller side (at least 15). */
  window?: number;
  /** How much darker than the local mean a pixel must be to count as ink. */
  k?: number;
}

/** Bradley-Roth adaptive threshold. Ink becomes 0, paper 255. */
export function adaptiveBinarize(g: GrayImage, opts: BinarizeOptions = {}): GrayImage {
  const { width: w, height: h } = g;
  const win = opts.window ?? Math.max(15, Math.round(Math.min(w, h) / 16));
  const k = opts.k ?? 0.15;
  const half = Math.floor(win / 2);
  // Integral image with one row and column of zeros; Float64 because 255·w·h overflows 32 bits.
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g.data[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      data[y * w + x] = g.data[y * w + x] < mean * (1 - k) ? 0 : 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * Size to draw the photo at before OCR: big phone photos are scaled down (Tesseract time grows with
 * pixels and 12 MP adds nothing for a document), small screenshots are scaled up (it reads text
 * best at 20-40 px of height).
 */
export function targetSize(width: number, height: number, maxSide = 2000, minSide = 1200): { width: number; height: number } {
  const side = Math.max(width, height);
  const scale = side > maxSide ? maxSide / side : side < minSide ? Math.min(3, minSide / side) : 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Bilinear resize of a gray image. */
export function resize(g: GrayImage, width: number, height: number): GrayImage {
  if (width === g.width && height === g.height) return g;
  const data = new Uint8ClampedArray(width * height);
  const sx = g.width / width;
  const sy = g.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(g.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(g.height - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(g.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(g.width - 1, x0 + 1);
      const dx = fx - x0;
      const top = g.data[y0 * g.width + x0] * (1 - dx) + g.data[y0 * g.width + x1] * dx;
      const bottom = g.data[y1 * g.width + x0] * (1 - dx) + g.data[y1 * g.width + x1] * dx;
      data[y * width + x] = Math.round(top * (1 - dy) + bottom * dy);
    }
  }
  return { width, height, data };
}

export interface PrepareOptions {
  binarize?: boolean;
  /** Resize to `targetSize` first (default true). */
  resize?: boolean;
}

/** Gray → resize to `targetSize` → invert when the background is dark → optional adaptive threshold. */
export function prepare(rgba: Uint8ClampedArray, width: number, height: number, opts: PrepareOptions = {}) {
  let g = toGray(rgba, width, height);
  if (opts.resize !== false) {
    const t = targetSize(width, height);
    g = resize(g, t.width, t.height);
  }
  const inverted = isDarkBackground(g);
  if (inverted) g = invert(g);
  if (opts.binarize) g = adaptiveBinarize(g);
  return { image: g, inverted };
}

/** Binary PGM (P5). Tesseract's image library reads it, so no PNG encoder is needed on either side. */
export function toPgm(g: GrayImage): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(`P5\n${g.width} ${g.height}\n255\n`);
  const out = new Uint8Array(header.length + g.data.length);
  out.set(header);
  out.set(g.data, header.length);
  return out;
}
