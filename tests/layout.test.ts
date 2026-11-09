import { describe, expect, it } from 'vitest';
import { extractDocuments } from '../src/extract.ts';
import { flatten, minConfidence, pageLines, wordsInSpan, type OcrWord } from '../src/layout.ts';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const w = (text: string, confidence = 90, symbols?: number[]): OcrWord => ({
  text,
  confidence,
  bbox: box,
  ...(symbols ? { symbols: [...text].map((t, i) => ({ text: t, confidence: symbols[i], bbox: box })) } : {}),
});

describe('layout', () => {
  const page = {
    blocks: [
      { paragraphs: [{ lines: [{ words: [w('CPF'), w('529.982.247-25', 80, [90, 90, 40, ...Array(11).fill(95)])] }] }] },
      { paragraphs: [{ lines: [{ words: [w('CNPJ'), w('11.222.333/0001-81')] }] }] },
    ],
  };

  it('joins words with spaces and lines with newlines, keeping offsets', () => {
    const { text, words } = flatten(pageLines(page));
    expect(text).toBe('CPF 529.982.247-25\nCNPJ 11.222.333/0001-81');
    expect(words.map((x) => [x.start, x.end, x.line])).toEqual([
      [0, 3, 0],
      [4, 18, 0],
      [19, 23, 1],
      [24, 42, 1],
    ]);
  });

  it('maps a finding back to its words and lowest character confidence', () => {
    const { text, words } = flatten(pageLines(page));
    const [cpf, cnpj] = extractDocuments(text);
    expect(wordsInSpan(words, cpf.start, cpf.end).map((x) => x.text)).toEqual(['529.982.247-25']);
    expect(minConfidence(words, cpf.start, cpf.end)).toBe(40);
    // only the characters inside the span count
    expect(minConfidence(words, cpf.start + 3, cpf.end)).toBe(95);
    expect(minConfidence(words, cnpj.start, cnpj.end)).toBe(90);
  });

  it('empty page', () => {
    expect(flatten(pageLines({ blocks: null }))).toEqual({ text: '', words: [] });
  });
});
