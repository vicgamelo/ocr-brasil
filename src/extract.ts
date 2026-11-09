// Finds CPF, CNPJ and boleto lines in OCR text.
//
// OCR mixes up digits and letters that look alike (0/O, 1/I/l, 5/S, 8/B...). A lookalike is only
// turned into a digit when the result passes the check digit, so a wrong guess never shows up as
// a valid document. Every change is reported with its offset in the text, so the UI can point at it.

import { type Boleto, checkBoleto } from './boleto.ts';
import { checkCnpj, checkCpf, type DocCheck } from './documents.ts';

export const LOOKALIKES: Readonly<Record<string, string>> = {
  O: '0', o: '0', Q: '0', D: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2',
  S: '5', s: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
};

export interface Correction {
  /** Offset in the OCR text. */
  index: number;
  from: string;
  to: string;
}

interface Base {
  start: number;
  end: number;
  /** The text as the OCR read it. */
  raw: string;
  valid: boolean;
  corrections: Correction[];
  /** Set when the first read was invalid and a second, digits-only read of the same strip fixed it. */
  reread?: string;
}

export interface DocFinding extends Base {
  type: 'CPF' | 'CNPJ';
  doc: DocCheck;
}

export interface BoletoFinding extends Base {
  type: 'BOLETO';
  /** null when the line has the wrong number of digits (47 bancário, 48 arrecadação; see `digitCount`). */
  boleto: Boleto | null;
  digitCount?: number;
}

export type Finding = DocFinding | BoletoFinding;

interface Char {
  ch: string;
  idx: number;
}

const D = `[0-9${Object.keys(LOOKALIKES).join('').replace(/[|!]/g, '\\$&')}]`;
const AN = '[0-9A-Za-z]';
const isDigit = (c: string) => c >= '0' && c <= '9';

/** Turns lookalikes into digits at the positions `mappable` allows. */
function interpret(chars: Char[], mappable: (i: number) => boolean, upper = false) {
  const corrections: Correction[] = [];
  let value = '';
  chars.forEach(({ ch, idx }, i) => {
    const to = mappable(i) && !isDigit(ch) ? LOOKALIKES[ch] : undefined;
    if (to) corrections.push({ index: idx, from: ch, to });
    value += to ?? (upper ? ch.toUpperCase() : ch);
  });
  return { value, corrections };
}

function groupChars(m: RegExpExecArray, skip: number[] = []): Char[] {
  const out: Char[] = [];
  for (let g = 1; g < m.length; g++) {
    if (skip.includes(g)) continue;
    const start = m.indices![g]![0];
    for (let k = 0; k < m[g].length; k++) out.push({ ch: m[g][k], idx: start + k });
  }
  return out;
}

// Separators the OCR may put between groups: punctuation, an optional space around it. Spaces only,
// never a newline: a document doesn't continue on the next line.
const S = ' ?[.,]? ?';
const CNPJ_RE = new RegExp(
  `(?<![0-9A-Za-z])(${AN}{2})${S}(${AN}{3})${S}(${AN}{3}) ?([/|]?) ?(${AN}{4}) ?[-–]? ?(${D}{2})(?![0-9A-Za-z])`,
  'dg',
);
// Only digits are refused before a CPF: the OCR often glues it to the label ("CPF529.982...").
const CPF_RE = new RegExp(
  `(?<![0-9])(${D}{3})${S}(${D}{3})${S}(${D}{3}) ?([-–.]?) ?(${D}{2})(?![0-9A-Za-z])`,
  'dg',
);

/**
 * Runs `re` over the text like matchAll, but when `read` rejects a match the search goes on from
 * the next character, not from the end of the match: "Emitente CNPJ 11.222..." first matches
 * "Emitente CNPJ 11" (letters are legal in a CNPJ), and the real number starts inside it.
 */
function scan(re: RegExp, text: string, read: (m: RegExpExecArray) => DocFinding | null): DocFinding[] {
  const out: DocFinding[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const f = read(m);
    if (f) out.push(f);
    else re.lastIndex = m.index + 1;
  }
  return out;
}

const findCnpjs = (text: string) =>
  scan(CNPJ_RE, text, (m) => {
    const chars = groupChars(m, [4]); // group 4 is the slash
    // As read (letters are legal in the first 12), or every lookalike as a digit (most CNPJs today).
    const asRead = interpret(chars, (i) => i >= 12, true);
    const numeric = interpret(chars, () => true, true);
    const valid = [asRead, numeric].find((c) => checkCnpj(c.value).valid);
    if (!valid) {
      // An invalid number only counts when it is written like a CNPJ.
      const digits = chars.slice(0, 12).filter((c) => isDigit(c.ch)).length;
      if (m[4] === '' || digits < 6) return null;
    }
    // Invalid and with letters that aren't lookalikes: it was meant as an alphanumeric CNPJ.
    const pick = valid ?? (/[A-Z]/.test(numeric.value) ? asRead : numeric);
    return finding('CNPJ', m, checkCnpj(pick.value), pick.corrections);
  });

const findCpfs = (text: string) =>
  scan(CPF_RE, text, (m) => {
    const chars = groupChars(m, [4]);
    const real = chars.filter((c) => isDigit(c.ch)).length;
    if (real < 7) return null;
    const { value, corrections } = interpret(chars, () => true);
    const doc = checkCpf(value);
    const formatted = /[.,]/.test(m[0]) && /[-–]/.test(m[0]);
    if (!doc.valid && !(formatted && real >= 9)) return null;
    return finding('CPF', m, doc, corrections);
  });

function finding(type: 'CPF' | 'CNPJ', m: RegExpExecArray, doc: DocCheck, corrections: Correction[]): DocFinding {
  return { type, start: m.index, end: m.index + m[0].length, raw: m[0], valid: doc.valid, corrections, doc };
}

/**
 * Boleto lines: runs of digits (and lookalikes) with spaces, dots and dashes in between, on one line
 * of text. A run may carry noise at the ends ("TO 23790..."), so every 47/48-digit window is tried.
 */
function findBoletos(text: string, today: Date): BoletoFinding[] {
  const out: BoletoFinding[] = [];
  const runRe = new RegExp(`${D}(?:[ .\\-–]*${D})*`, 'g');
  for (const m of text.matchAll(runRe)) {
    const chars: Char[] = [];
    for (let k = 0; k < m[0].length; k++) {
      const ch = m[0][k];
      if (isDigit(ch) || LOOKALIKES[ch]) chars.push({ ch, idx: m.index + k });
    }
    // a boleto line has 47-48 digits; allow a fair share of them read as letters
    const real = chars.filter((c) => isDigit(c.ch)).length;
    if (chars.length < 44 || real < 30) continue;

    type Cand = { win: Char[]; corrections: Correction[]; boleto: Boleto };
    const cands: Cand[] = [];
    for (const len of [47, 48]) {
      for (let s = 0; s + len <= chars.length; s++) {
        const win = chars.slice(s, s + len);
        const { value, corrections } = interpret(win, () => true);
        if ((len === 48) !== (value[0] === '8')) continue;
        const boleto = checkBoleto(value, today);
        if (boleto) cands.push({ win, corrections, boleto });
      }
    }
    const score = (c: Cand) =>
      (c.boleto.valid ? 1000 : 0) + c.boleto.fields.filter((f) => f.ok).length * 10 - c.corrections.length;
    const best = cands.sort((a, b) => score(b) - score(a))[0];
    if (!best) {
      const n = chars.length;
      out.push({
        type: 'BOLETO',
        start: chars[0].idx,
        end: chars[n - 1].idx + 1,
        raw: text.slice(chars[0].idx, chars[n - 1].idx + 1),
        valid: false,
        corrections: [],
        boleto: null,
        digitCount: n,
      });
      continue;
    }
    const start = best.win[0].idx;
    const end = best.win[best.win.length - 1].idx + 1;
    out.push({
      type: 'BOLETO',
      start,
      end,
      raw: text.slice(start, end),
      valid: best.boleto.valid,
      corrections: best.corrections,
      boleto: best.boleto,
    });
  }
  return out;
}

export interface ExtractOptions {
  /** Reference date for the boleto due-date factor (it wrapped around in 2025). */
  today?: Date;
}

/** Every CPF, CNPJ and boleto line in the text, in reading order. Invalid ones are kept so the UI can explain why. */
export function extractDocuments(text: string, opts: ExtractOptions = {}): Finding[] {
  const taken: [number, number][] = [];
  const free = (f: Finding) => taken.every(([s, e]) => f.end <= s || f.start >= e);
  const out: Finding[] = [];
  for (const group of [findBoletos(text, opts.today ?? new Date()), findCnpjs(text), findCpfs(text)]) {
    for (const f of group) {
      if (!free(f)) continue;
      taken.push([f.start, f.end]);
      out.push(f);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
