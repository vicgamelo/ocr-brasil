// Runs the real Tesseract (WASM, Portuguese LSTM model from node_modules) on the sample images in
// fixtures/ and checks that every document in them comes out valid. Regenerate them with
// `npm run fixtures`. The demo page runs the same pipeline in the browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Finding } from '../src/extract.ts';
import { createReader, type Reader } from '../src/ocr.ts';
import { prepare, toPgm } from '../src/preprocess.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '..', 'fixtures');
const expected: Record<string, string[]> = JSON.parse(readFileSync(join(FIX, 'expected.json'), 'utf8'));
const langPath = join(dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/por')), '4.0.0_best_int');
const TODAY = new Date('2026-11-09T12:00:00Z');

function rgba(file: string) {
  const buf = readFileSync(join(FIX, file));
  if (file.endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const img = jpeg.decode(buf, { useTArray: true });
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}


const key = (f: Finding) =>
  f.type === 'BOLETO' ? `BOLETO:${f.boleto?.linha ?? '?'}` : `${f.type}:${f.doc.value}`;

let reader: Reader;
beforeAll(async () => {
  reader = await createReader({ langPath, cacheMethod: 'none' });
});
afterAll(async () => {
  await reader?.terminate();
});

async function read(file: string, binarize: boolean, reread = true) {
  const { data, width, height } = rgba(file);
  const { image } = prepare(data, width, height, { binarize });
  return reader.read(Buffer.from(toPgm(image)), { today: TODAY, reread });
}

// What the demo ships: resize, adaptive threshold, re-read of invalid findings.
describe.each(Object.keys(expected))('%s', (file) => {
  it('every document found and valid', async () => {
    const r = await read(file, true);
    const valid = r.findings.filter((f) => f.valid).map(key);
    if (process.env.OCR_DEBUG) console.log(file, r.reread, r.ms, 'ms', r.confidence, JSON.stringify(r.text), r.findings.map((f) => [key(f), f.valid, f.corrections.length]));
    expect(valid, r.text).toEqual(expect.arrayContaining(expected[file]));
    // nothing else claims to be a valid document
    expect(valid.length, r.text).toBe(expected[file].length);
  });
});

describe('why each step is there', () => {
  it('the adaptive threshold reads the shadowed corner of the photo', async () => {
    expect((await read('nota-foto.jpg', true)).text).toContain('125,00');
  });

  it('the re-read fixes a boleto whose first read failed the check digit', async () => {
    const first = await read('boleto-foto.jpg', true, false);
    const boleto = first.findings.find((f) => f.type === 'BOLETO');
    expect(boleto?.valid).toBe(false);
    const second = await read('boleto-foto.jpg', true, true);
    const fixed = second.findings.find((f) => f.type === 'BOLETO');
    expect(fixed).toMatchObject({ valid: true, reread: expect.any(String) });
    expect(second.reread).toBeGreaterThanOrEqual(1);
  });
});
