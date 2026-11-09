import boletoUtils from '@mrmgomes/boleto-utils';
import { describe, expect, it } from 'vitest';
import {
  arrecadacaoBarcodeToLinha,
  bancarioBarcodeToLinha,
  checkBoleto,
  dueDateFromFactor,
  factorFromDate,
  mod10,
  mod11Arrecadacao,
  mod11Bancario,
} from '../src/boleto.ts';

const TODAY = new Date('2026-11-09T12:00:00Z');

// Public examples (boleto-utils README and the usual electricity bill example).
const BRADESCO = '23790448095616862379336011058009740430000124020';
const ITAU_BARCODE = '34196790600001000002220000005566385101214000';
const ENERGIA = '836400000011331201380002812884627116080136181551';

describe('known boletos', () => {
  it('bancário linha: fields, general digit, bank and amount', () => {
    const b = checkBoleto('23790.44809 56168.623793 36011.058009 7 40430000124020', TODAY)!;
    expect(b).toMatchObject({ kind: 'bancario', valid: true, amountCents: 124020, bank: { code: '237', name: 'Bradesco' } });
    expect(b.barcode).toBe('23797404300001240200448056168623793601105800');
    expect(b.fields.map((f) => f.ok)).toEqual([true, true, true]);
    expect(b.formatted).toBe('23790.44809 56168.623793 36011.058009 7 40430000124020');
  });

  it('bancário barcode → same linha as the bank prints', () => {
    const b = checkBoleto(ITAU_BARCODE, TODAY)!;
    expect(b.valid).toBe(true);
    expect(b.linha).toBe('34192220090000556638551012140003679060000100000');
    expect(b.amountCents).toBe(100000);
  });

  it('arrecadação: segment, mod 10 blocks, amount', () => {
    const b = checkBoleto(ENERGIA, TODAY)!;
    expect(b).toMatchObject({ kind: 'arrecadacao', valid: true, amountCents: 13312, segment: { code: '3' } });
    expect(b.formatted).toBe('83640000001-1 33120138000-2 81288462711-6 08013618155-1');
  });

  it('points at the field with the wrong digit', () => {
    const wrong = `${BRADESCO.slice(0, 20)}${(Number(BRADESCO[20]) + 1) % 10}${BRADESCO.slice(21)}`;
    const b = checkBoleto(wrong, TODAY)!;
    expect(b.valid).toBe(false);
    expect(b.fields.map((f) => f.ok)).toEqual([true, false, true]);
    expect(b.fields[1].expected).toBe(BRADESCO[20]);
  });

  it('a digit swapped in the amount breaks only the general digit', () => {
    const l = BRADESCO.split('');
    [l[44], l[45]] = [l[45], l[44]];
    const b = checkBoleto(l.join(''), TODAY)!;
    expect(b.fields.every((f) => f.ok)).toBe(true);
    expect(b.general.ok).toBe(false);
    expect(b.valid).toBe(false);
  });

  it('arrecadação with an unknown value identifier is invalid', () => {
    const barcode = '83' + '5' + '0' + '0'.repeat(40);
    const b = checkBoleto(barcode, TODAY)!;
    expect(b.valid).toBe(false);
    expect(b.badValueId).toBe('5');
  });

  it('ignores anything that is not 44, 47 or 48 digits', () => {
    expect(checkBoleto('123')).toBeNull();
    expect(checkBoleto(BRADESCO.slice(1))).toBeNull();
    // 48 digits that don't start with 8 aren't an arrecadação
    expect(checkBoleto(`1${ENERGIA.slice(1)}`)).toBeNull();
  });
});

describe('due-date factor', () => {
  it('first cycle: 1000 = 2000-07-03, 9999 = 2025-02-21', () => {
    expect(dueDateFromFactor(1000, new Date('2001-01-01'))).toBe('2000-07-03');
    expect(dueDateFromFactor(9999, new Date('2025-02-01'))).toBe('2025-02-21');
  });

  it('wrapped on 2025-02-22 back to 1000', () => {
    expect(dueDateFromFactor(1000, TODAY)).toBe('2025-02-22');
    expect(factorFromDate('2025-02-22')).toBe(1000);
    expect(dueDateFromFactor(factorFromDate('2026-12-10'), TODAY)).toBe('2026-12-10');
  });

  it('picks the cycle closer to today', () => {
    // 4043 (the Bradesco example): 2008-11-01 in the old cycle, 2033-06-23 in the new one
    expect(dueDateFromFactor(4043, TODAY)).toBe('2033-06-23');
    expect(dueDateFromFactor(4043, new Date('2010-01-01'))).toBe('2008-11-01');
    expect(checkBoleto(BRADESCO, new Date('2008-10-20'))!.dueDate).toBe('2008-11-01');
    expect(dueDateFromFactor(0, TODAY)).toBeNull();
  });
});

// Cross-check against an independent implementation (boleto-utils) on random codes.
// Two known gaps there, so those are checked against the generated digits instead:
// - the amount parser drops leading digits when the second one is 0 (8071733546 → 717335.46);
// - for arrecadação mod 11 linhas it checks the 4 block digits but not the general one.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}
const randDigits = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

describe('agrees with boleto-utils', () => {
  const r = rng(42);

  it('500 random bancário barcodes', () => {
    for (let i = 0; i < 500; i++) {
      // bank codes starting with 8 don't exist: 8 marks arrecadação
      const body = String(Math.floor(r() * 8)) + randDigits(r, 2) + '9' + String(1000 + Math.floor(r() * 9000)) + randDigits(r, 10) + randDigits(r, 25);
      const barcode = body.slice(0, 4) + mod11Bancario(body) + body.slice(4);
      const linha = bancarioBarcodeToLinha(barcode);
      const ours = checkBoleto(linha, TODAY)!;
      const theirs = boletoUtils.validarBoleto(linha);
      expect(ours.valid).toBe(true);
      expect(theirs.sucesso).toBe(true);
      expect(ours.barcode).toBe(theirs.codigoBarras);
      expect(ours.amountCents ?? 0).toBe(Number(body.slice(8, 18)));

      // One digit off in fields 1-3 (or their digits): mod 10 catches every single-digit change.
      // Not in the amount/factor: boleto-utils skips the general digit on a linha, and mod 11 there
      // maps 0, 10 and 11 to 1, so a few single-digit changes pass by design of the layout.
      const pos = Math.floor(r() * 32);
      const bad = linha.slice(0, pos) + ((Number(linha[pos]) + 1 + Math.floor(r() * 9)) % 10) + linha.slice(pos + 1);
      expect(checkBoleto(bad, TODAY)?.valid ?? false).toBe(false);
      if (bad[0] !== '8') expect(boletoUtils.validarBoleto(bad).sucesso).toBe(false);
    }
  });

  it('400 random arrecadação barcodes (mod 10 and mod 11)', () => {
    for (let i = 0; i < 400; i++) {
      const id = '6789'[i % 4];
      const seg = '1234567'[Math.floor(r() * 7)];
      const body = '8' + seg + id + randDigits(r, 40);
      const mod = id === '8' || id === '9' ? mod11Arrecadacao : mod10;
      const barcode = body.slice(0, 3) + mod(body) + body.slice(3);
      const linha = arrecadacaoBarcodeToLinha(barcode);
      const ours = checkBoleto(linha, TODAY)!;
      const theirs = boletoUtils.validarBoleto(linha);
      expect(ours.valid, linha).toBe(true);
      expect(theirs.sucesso, linha).toBe(true);
      expect(ours.barcode).toBe(theirs.codigoBarras);

      const pos = Math.floor(r() * 48);
      const bad = linha.slice(0, pos) + ((Number(linha[pos]) + 1 + Math.floor(r() * 9)) % 10) + linha.slice(pos + 1);
      // first digit changes the type; boleto-utils throws on an unknown value identifier (3rd digit)
      if (pos === 0) continue;
      expect(checkBoleto(bad, TODAY)!.valid, bad).toBe(false);
      if (pos !== 2 && mod === mod10) expect(boletoUtils.validarBoleto(bad).sucesso, bad).toBe(false);
    }
  });
});
