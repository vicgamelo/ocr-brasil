import { describe, expect, it } from 'vitest';
import { adaptiveBinarize, grayToRgba, isDarkBackground, otsuThreshold, prepare, resize, targetSize, toGray, toPgm, type GrayImage } from '../src/preprocess.ts';

function image(w: number, h: number, f: (x: number, y: number) => number): GrayImage {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { width: w, height: h, data };
}
const at = (g: GrayImage, x: number, y: number) => g.data[y * g.width + x];
// "ink": 3-px vertical strokes every 10 px, 60 levels darker than the paper around them
const strokes = (paper: (x: number) => number) => (x: number, y: number) =>
  x % 10 < 3 && y > 10 && y < 50 ? paper(x) - 60 : paper(x);

describe('preprocess', () => {
  it('gray uses BT.601 luma', () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1);
    expect([...g.data]).toEqual([76, 150, 29]);
    expect([...grayToRgba(g).slice(0, 4)]).toEqual([76, 76, 76, 255]);
  });

  it('Otsu splits two levels between them', () => {
    const t = otsuThreshold(image(10, 10, (x) => (x < 5 ? 40 : 200)));
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(200);
  });

  it('adaptive threshold keeps ink under a shadow that a global threshold loses', () => {
    // light falls from 230 on the left to 110 on the right
    const g = image(200, 60, strokes((x) => 230 - (120 * x) / 199));
    const t = otsuThreshold(g);
    // the global threshold turns the clean paper on the right into ink
    expect(at(g, 195, 5)).toBeLessThanOrEqual(t);
    const b = adaptiveBinarize(g, { window: 25 });
    for (const x of [1, 101, 191]) expect(at(b, x, 30), `ink at x=${x}`).toBe(0);
    for (const x of [6, 106, 196]) expect(at(b, x, 30), `paper at x=${x}`).toBe(255);
  });

  it('detects light text on a dark background and inverts it', () => {
    const dark = image(50, 50, (x, y) => (x % 10 < 2 && y % 10 < 6 ? 230 : 30));
    expect(isDarkBackground(dark)).toBe(true);
    const rgba = grayToRgba(dark);
    const { image: out, inverted } = prepare(rgba, 50, 50, { resize: false });
    expect(inverted).toBe(true);
    expect(at(out, 5, 5)).toBe(225);
    expect(isDarkBackground(image(50, 50, () => 240))).toBe(false);
  });

  it('target size: big photos down, small screenshots up, at most 3x', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(targetSize(600, 200)).toEqual({ width: 1200, height: 400 });
    expect(targetSize(100, 50)).toEqual({ width: 300, height: 150 });
    expect(targetSize(1500, 1000)).toEqual({ width: 1500, height: 1000 });
  });
});

describe('resize', () => {
  it('bilinear keeps flat areas and the mean of a ramp', () => {
    const flat = resize(image(10, 10, () => 77), 25, 5);
    expect(new Set(flat.data)).toEqual(new Set([77]));
    const ramp = resize(image(100, 1, (x) => x * 2), 50, 1);
    expect(ramp.data[0]).toBe(1);
    expect(ramp.data[49]).toBe(197);
  });

  it('prepare scales a small screenshot up before thresholding', () => {
    const rgba = grayToRgba(image(400, 100, () => 240));
    expect(prepare(rgba, 400, 100).image).toMatchObject({ width: 1200, height: 300 });
  });
});

it('PGM header + raw bytes', () => {
  const g = image(3, 2, (x, y) => x + 10 * y);
  const pgm = toPgm(g);
  expect(new TextDecoder().decode(pgm.slice(0, 11))).toBe('P5\n3 2\n255\n');
  expect([...pgm.slice(11)]).toEqual([0, 1, 2, 10, 11, 12]);
});
