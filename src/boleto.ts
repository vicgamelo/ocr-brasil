// Boleto check digits (FEBRABAN layouts).
//
// Bancário (cobrança): 47-digit "linha digitável", 44-digit barcode.
//   linha = AAABC.CCCCX DDDDD.DDDDDY EEEEE.EEEEEZ K UUUUVVVVVVVVVV
//   A bank, B currency (9 = real), C/D/E free field, X/Y/Z mod 10 of each field,
//   K general digit (mod 11 over the barcode), U due-date factor, V amount in cents.
// Arrecadação (utilities, taxes): 48-digit linha, 4 blocks of 11 digits + 1 check digit.
//   Third digit says how the digits are computed: 6/7 mod 10, 8/9 mod 11 (6/8 = amount in reais).

export type BoletoKind = 'bancario' | 'arrecadacao';

export interface FieldCheck {
  /** 1-based field number as printed on the boleto. */
  field: number;
  digits: string;
  got: string;
  expected: string;
  ok: boolean;
}

export interface Boleto {
  kind: BoletoKind;
  valid: boolean;
  /** Only digits. 47 or 48 for a linha digitável, 44 for a barcode. */
  linha: string;
  formatted: string;
  barcode: string;
  fields: FieldCheck[];
  general: { got: string; expected: string; ok: boolean };
  /** Amount in cents; null when the boleto leaves it open (zeros) or it isn't an amount in reais. */
  amountCents: number | null;
  /** ISO date (YYYY-MM-DD), bancário only; null when the factor is 0000. */
  dueDate: string | null;
  bank?: { code: string; name: string | null };
  segment?: { code: string; name: string };
  /** Arrecadação whose 3rd digit (value identifier) isn't 6, 7, 8 or 9: invalid whatever the digits say. */
  badValueId?: string;
}

/** Mod 10 used in the linha digitável fields: weights 2,1,2,1... from the right, digits of each product summed. */
export function mod10(digits: string): number {
  let sum = 0;
  let w = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * w;
    sum += p > 9 ? p - 9 : p;
    w = w === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(digits: string): number {
  let sum = 0;
  let w = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  return sum % 11;
}

/** General digit of a bancário barcode (the 43 digits without position 5): 0, 10 and 11 become 1. */
export function mod11Bancario(digits: string): number {
  const dv = 11 - mod11Sum(digits);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Mod 11 of arrecadação: remainder 0 or 1 gives 0. */
export function mod11Arrecadacao(digits: string): number {
  const rest = mod11Sum(digits);
  return rest < 2 ? 0 : 11 - rest;
}

// A few large banks, so the demo can say a name. Anything else shows the code only.
const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '077': 'Inter',
  '104': 'Caixa Econômica Federal',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nu Pagamentos',
  '336': 'C6 Bank',
  '341': 'Itaú Unibanco',
  '422': 'Safra',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

const SEGMENTS: Record<string, string> = {
  '1': 'Prefeituras',
  '2': 'Saneamento',
  '3': 'Energia elétrica e gás',
  '4': 'Telecomunicações',
  '5': 'Órgãos governamentais',
  '6': 'Carnês e assemelhados',
  '7': 'Multas de trânsito',
  '9': 'Uso exclusivo do banco',
};

const DAY = 86_400_000;
const OLD_BASE = Date.UTC(1997, 9, 7); // factor 0 of the first cycle (1000 = 2000-07-03)
const NEW_BASE = Date.UTC(2025, 1, 22); // factor 1000 again from 2025-02-22, after 9999 on 2025-02-21

/**
 * Due date from the 4-digit factor. The factor wrapped around on 2025-02-22 (9999 → 1000), so every
 * factor maps to two dates 25 years apart; we take the one closer to `today`.
 */
export function dueDateFromFactor(factor: number, today: Date = new Date()): string | null {
  if (factor === 0) return null;
  const old = OLD_BASE + factor * DAY;
  if (factor < 1000) return new Date(old).toISOString().slice(0, 10);
  const recent = NEW_BASE + (factor - 1000) * DAY;
  const t = today.getTime();
  return new Date(Math.abs(recent - t) <= Math.abs(old - t) ? recent : old).toISOString().slice(0, 10);
}

/** Factor for a due date, in the current cycle (inverse of dueDateFromFactor for dates from 2025-02-22). */
export function factorFromDate(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return t >= NEW_BASE ? 1000 + Math.round((t - NEW_BASE) / DAY) : Math.round((t - OLD_BASE) / DAY);
}

const formatBancario = (l: string) =>
  `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
const formatArrecadacao = (l: string) => [0, 12, 24, 36].map((i) => `${l.slice(i, i + 11)}-${l[i + 11]}`).join(' ');

export function bancarioBarcodeToLinha(b: string): string {
  const f1 = b.slice(0, 4) + b.slice(19, 24);
  const f2 = b.slice(24, 34);
  const f3 = b.slice(34, 44);
  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${b[4]}${b.slice(5, 19)}`;
}

export function arrecadacaoBarcodeToLinha(b: string): string {
  const mod = b[2] === '8' || b[2] === '9' ? mod11Arrecadacao : mod10;
  return [0, 11, 22, 33].map((i) => b.slice(i, i + 11) + mod(b.slice(i, i + 11))).join('');
}

function checkBancario(linha: string, barcode: string, today: Date): Boleto {
  const fields: FieldCheck[] = [
    [0, 9],
    [10, 20],
    [21, 31],
  ].map(([s, e], i) => {
    const digits = linha.slice(s, e);
    const expected = String(mod10(digits));
    return { field: i + 1, digits, got: linha[e], expected, ok: linha[e] === expected };
  });
  const general = { got: barcode[4], expected: String(mod11Bancario(barcode.slice(0, 4) + barcode.slice(5))) };
  const amount = Number(barcode.slice(9, 19));
  const code = barcode.slice(0, 3);
  return {
    kind: 'bancario',
    valid: fields.every((f) => f.ok) && general.got === general.expected,
    linha,
    formatted: formatBancario(linha),
    barcode,
    fields,
    general: { ...general, ok: general.got === general.expected },
    amountCents: amount > 0 ? amount : null,
    dueDate: dueDateFromFactor(Number(barcode.slice(5, 9)), today),
    bank: { code, name: BANKS[code] ?? null },
  };
}

function checkArrecadacao(linha: string, barcode: string): Boleto {
  const id = barcode[2];
  const known = '6789'.includes(id);
  const mod = id === '8' || id === '9' ? mod11Arrecadacao : mod10;
  const fields: FieldCheck[] = [0, 12, 24, 36].map((s, i) => {
    const digits = linha.slice(s, s + 11);
    const expected = String(mod(digits));
    return { field: i + 1, digits, got: linha[s + 11], expected, ok: linha[s + 11] === expected };
  });
  const expected = String(mod(barcode.slice(0, 3) + barcode.slice(4)));
  const general = { got: barcode[3], expected, ok: barcode[3] === expected };
  const amount = Number(barcode.slice(4, 15));
  return {
    kind: 'arrecadacao',
    valid: known && fields.every((f) => f.ok) && general.ok,
    linha,
    formatted: formatArrecadacao(linha),
    barcode,
    fields,
    general,
    amountCents: (id === '6' || id === '8') && amount > 0 ? amount : null,
    dueDate: null,
    segment: { code: barcode[1], name: SEGMENTS[barcode[1]] ?? 'Desconhecido' },
    ...(known ? {} : { badValueId: id }),
  };
}

/**
 * Checks a linha digitável (47 or 48 digits) or a barcode (44 digits). Anything that isn't a digit
 * is ignored, so "23790.44809 56168.623793 ..." works. Returns null for any other length.
 */
export function checkBoleto(input: string, today: Date = new Date()): Boleto | null {
  const d = input.replace(/\D/g, '');
  if (d.length === 47 && d[0] !== '8') {
    const barcode = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return checkBancario(d, barcode, today);
  }
  if (d.length === 48 && d[0] === '8') {
    const barcode = [0, 12, 24, 36].map((i) => d.slice(i, i + 11)).join('');
    return checkArrecadacao(d, barcode);
  }
  // A barcode has only the general digit; the field digits of the linha are derived from it.
  if (d.length === 44)
    return d[0] === '8' ? checkArrecadacao(arrecadacaoBarcodeToLinha(d), d) : checkBancario(bancarioBarcodeToLinha(d), d, today);
  return null;
}
