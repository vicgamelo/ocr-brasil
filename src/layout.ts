// Flattens Tesseract's blocks → paragraphs → lines → words into one string, keeping the offset of
// every word, so a finding (an offset range in the text) can be drawn back as boxes on the image.

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Bbox;
  symbols?: { text: string; confidence: number; bbox: Bbox }[];
}

export interface PlacedWord extends OcrWord {
  start: number;
  end: number;
  line: number;
}

/** The parts of a Tesseract.js Page we read (`recognize(img, {}, { blocks: true })`). */
export interface PageLike {
  blocks: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null;
}

export function pageLines(page: PageLike): OcrWord[][] {
  return (page.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => l.words)));
}

/** Words joined by a space, lines by "\n". */
export function flatten(lines: OcrWord[][]): { text: string; words: PlacedWord[] } {
  const words: PlacedWord[] = [];
  let text = '';
  lines.forEach((line, li) => {
    if (li > 0) text += '\n';
    line.forEach((w, wi) => {
      if (wi > 0) text += ' ';
      words.push({ ...w, start: text.length, end: text.length + w.text.length, line: li });
      text += w.text;
    });
  });
  return { text, words };
}

export function wordsInSpan(words: PlacedWord[], start: number, end: number): PlacedWord[] {
  return words.filter((w) => w.start < end && w.end > start);
}

/** The lowest per-character confidence inside [start, end) (the word's, when Tesseract gave no symbols). */
export function minConfidence(words: PlacedWord[], start: number, end: number): number | null {
  let min: number | null = null;
  const take = (c: number) => (min = min === null ? c : Math.min(min, c));
  for (const w of wordsInSpan(words, start, end)) {
    const symbols = w.symbols ?? [];
    if (symbols.map((s) => s.text).join('') !== w.text) {
      take(w.confidence);
      continue;
    }
    let at = w.start;
    for (const s of symbols) {
      if (at < end && at + s.text.length > start) take(s.confidence);
      at += s.text.length;
    }
  }
  return min;
}
