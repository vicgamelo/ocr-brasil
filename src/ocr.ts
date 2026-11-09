// Thin wrapper around a Tesseract.js worker: Portuguese LSTM model, files from our own origin, and
// the result already flattened and run through the document extractor.

import { createWorker, OEM, PSM, type ImageLike, type LoggerMessage } from 'tesseract.js';
import { extractDocuments, type Finding } from './extract.ts';
import { flatten, pageLines, wordsInSpan, type PageLike, type PlacedWord } from './layout.ts';

export interface ReaderOptions {
  /** URL of tesseract.js `worker.min.js`. In Node it is resolved from node_modules. */
  workerPath?: string;
  /** Folder with the `tesseract-core-*-lstm.wasm.js` files (tesseract.js picks SIMD or not). */
  corePath?: string;
  /** Folder with `por.traineddata.gz`. */
  langPath?: string;
  logger?: (m: LoggerMessage) => void;
  /** Where the language file is cached. Browser default is IndexedDB; 'none' turns it off. */
  cacheMethod?: 'write' | 'readOnly' | 'refresh' | 'none';
}

/**
 * - `document`: free text (page segmentation auto). Lookalike letters are fixed by the extractor.
 * - `digits`: only digits and separators; best for a crop of a boleto line.
 */
export type Mode = 'document' | 'digits';

export interface ReadOptions {
  mode?: Mode;
  /** Reference date for the boleto due date. */
  today?: Date;
  /**
   * Re-read each invalid finding on its own, as a single line of digits (default true). The check
   * digit says the first read was wrong; a second look at just that strip, with letters ruled out,
   * often gets it right. It only replaces the finding when the re-read passes the check.
   */
  reread?: boolean;
}

export interface ReadResult {
  text: string;
  words: PlacedWord[];
  findings: Finding[];
  /** Mean word confidence from Tesseract, 0-100. */
  confidence: number;
  ms: number;
  /** How many findings were fixed by the re-read. */
  reread: number;
}

const DIGITS = '0123456789 .-/';

export async function createReader(opts: ReaderOptions = {}) {
  const { logger, ...paths } = opts;
  const worker = await createWorker('por', OEM.LSTM_ONLY, {
    ...paths,
    // A blob: worker would need worker-src blob: in the CSP; load the file from our own origin.
    workerBlobURL: false,
    gzip: true,
    ...(logger ? { logger } : {}),
  });
  let current: Mode | 'line' | null = null;

  async function setMode(mode: Mode | 'line') {
    if (mode === current) return;
    // The PGM carries no DPI; without one Tesseract guesses it and logs "Estimating resolution".
    const dpi = { user_defined_dpi: '300' };
    const params = {
      document: { tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.AUTO },
      digits: { tessedit_char_whitelist: DIGITS, tessedit_pageseg_mode: PSM.SINGLE_BLOCK },
      line: { tessedit_char_whitelist: DIGITS, tessedit_pageseg_mode: PSM.SINGLE_LINE },
    }[mode];
    await worker.setParameters({ ...dpi, ...params });
    current = mode;
  }

  /** Second look at one invalid finding: just its strip of the image, digits only. */
  async function reread(image: ImageLike, f: Finding, words: PlacedWord[], today?: Date): Promise<Finding | null> {
    // letters are part of an alphanumeric CNPJ, so a digits-only read can't fix it
    if (f.type === 'CNPJ' && f.doc.alphanumeric) return null;
    const ws = wordsInSpan(words, f.start, f.end);
    if (!ws.length) return null;
    const x0 = Math.min(...ws.map((w) => w.bbox.x0));
    const y0 = Math.min(...ws.map((w) => w.bbox.y0));
    const x1 = Math.max(...ws.map((w) => w.bbox.x1));
    const y1 = Math.max(...ws.map((w) => w.bbox.y1));
    const pad = Math.round((y1 - y0) * 0.4);
    const left = Math.max(0, x0 - pad);
    const top = Math.max(0, y0 - pad);
    const rectangle = { left, top, width: x1 + pad - left, height: y1 + pad - top };
    await setMode('line');
    const { data } = await worker.recognize(image, { rectangle }, { text: true });
    const again = extractDocuments(data.text, { today }).find((g) => g.type === f.type && g.valid);
    if (!again) return null;
    // keep where it was found in the page text; corrections refer to the first read
    return { ...again, start: f.start, end: f.end, raw: f.raw, corrections: [], reread: data.text.trim() };
  }

  return {
    async read(image: ImageLike, opts: ReadOptions = {}): Promise<ReadResult> {
      const { mode = 'document', today, reread: retry = true } = opts;
      const t0 = performance.now();
      await setMode(mode);
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const { text, words } = flatten(pageLines(data as unknown as PageLike));
      const findings = extractDocuments(text, { today });
      let fixed = 0;
      if (retry) {
        for (const [i, f] of findings.entries()) {
          if (f.valid) continue;
          const better = await reread(image, f, words, today);
          if (better) {
            findings[i] = better;
            fixed++;
          }
        }
      }
      return {
        text,
        words,
        findings,
        confidence: data.confidence,
        ms: Math.round(performance.now() - t0),
        reread: fixed,
      };
    },
    terminate: () => worker.terminate(),
  };
}

export type Reader = Awaited<ReturnType<typeof createReader>>;
