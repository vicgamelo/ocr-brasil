import { describe, expect, it } from 'vitest';
import type { BoletoFinding, DocFinding } from '../src/extract.ts';
import { extractDocuments } from '../src/extract.ts';

const TODAY = new Date('2026-11-09T12:00:00Z');
const run = (t: string) => extractDocuments(t, { today: TODAY });

describe('CPF and CNPJ in OCR text', () => {
  it('finds formatted documents with their offsets', () => {
    const text = 'Tomador: Fulana\nCPF: 529.982.247-25\nEmitente CNPJ 11.222.333/0001-81';
    const [cpf, cnpj] = run(text) as DocFinding[];
    expect(cpf).toMatchObject({ type: 'CPF', valid: true, corrections: [] });
    expect(text.slice(cpf.start, cpf.end)).toBe('529.982.247-25');
    expect(cnpj).toMatchObject({ type: 'CNPJ', valid: true, raw: '11.222.333/0001-81' });
  });

  it('alphanumeric CNPJ, lowercase and with a space after a dot', () => {
    const [f] = run('CNPJ: 12.abc. 345/01de-35') as DocFinding[];
    expect(f).toMatchObject({ type: 'CNPJ', valid: true, corrections: [] });
    expect(f.doc.formatted).toBe('12.ABC.345/01DE-35');
  });

  it('fixes lookalikes only when the check digit agrees', () => {
    const text = 'CNPJ 11.222.333/OOO1-8l';
    const [f] = run(text) as DocFinding[];
    expect(f.valid).toBe(true);
    expect(f.doc.value).toBe('11222333000181');
    expect(f.corrections.map((c) => `${text[c.index]}→${c.to}`)).toEqual(['O→0', 'O→0', 'O→0', 'l→1']);
  });

  it('CPF read with S and B', () => {
    const [f] = run('CPF S29.9B2.247-2S') as DocFinding[];
    expect(f).toMatchObject({ type: 'CPF', valid: true });
    expect(f.doc.formatted).toBe('529.982.247-25');
    expect(f.corrections).toHaveLength(3);
  });

  it('keeps a wrong but well-formatted CPF, with the digits it should have', () => {
    const [f] = run('CPF 529.982.247-24') as DocFinding[];
    expect(f).toMatchObject({ type: 'CPF', valid: false });
    expect(f.doc.expected).toBe('25');
  });

  it('a wrong alphanumeric CNPJ stays as read (no lookalike guessing)', () => {
    const [f] = run('CNPJ 12.ABC.345/01DE-36') as DocFinding[];
    expect(f).toMatchObject({ type: 'CNPJ', valid: false });
    expect(f.doc.value).toBe('12ABC34501DE36');
    expect(f.doc.expected).toBe('35');
  });

  it('ignores plain numbers and words that fail the check', () => {
    expect(run('Telefone (11) 98765-4321 pedido 12345678901 SIGOBTZSBGQ')).toEqual([]);
    expect(run('Nota 000123456 série 1 valor 1.234,56')).toEqual([]);
  });
});

describe('boleto lines in OCR text', () => {
  const LINHA = '23790.44809 56168.623793 36011.058009 7 40430000124020';

  it('finds the linha digitável with noise around it', () => {
    const text = `Banco Bradesco | 237-2 | ${LINHA}\nPagador: Fulana  CPF 529.982.247-25`;
    const [b, cpf] = run(text);
    expect(b.type).toBe('BOLETO');
    expect(b.valid).toBe(true);
    expect((b as BoletoFinding).boleto?.formatted).toBe(LINHA);
    expect(text.slice(b.start, b.end)).toBe(LINHA);
    expect(cpf).toMatchObject({ type: 'CPF', valid: true });
  });

  it('OCR merged and split groups and read some digits as letters', () => {
    const text = 'TO 2379O.448O9 56l68 .623793 36011.O58OO9 7 4O43OOOO124O2O';
    const [b] = run(text) as BoletoFinding[];
    expect(b.valid).toBe(true);
    expect(b.boleto!.linha).toBe('23790448095616862379336011058009740430000124020');
    expect(b.corrections.length).toBe(13); // every O and l in the text above
    // "TO" in front looks like digits too, but the valid window starts at "2379O"
    expect(text.slice(b.start, b.start + 5)).toBe('2379O');
  });

  it('a wrong digit: points at the field', () => {
    const [b] = run('23790.44809 56168.623794 36011.058009 7 40430000124020') as BoletoFinding[];
    expect(b.valid).toBe(false);
    expect(b.boleto!.fields.map((f) => f.ok)).toEqual([true, false, true]);
  });

  it('a dropped digit: says how many it found', () => {
    const [b] = run('23790.44809 56168.62379 36011.058009 7 40430000124020') as BoletoFinding[];
    expect(b).toMatchObject({ valid: false, boleto: null });
    expect(b.digitCount).toBe(46);
  });

  it('arrecadação with dashes, and the numbers inside are not read as CPF/CNPJ', () => {
    const found = run('83640000001-1 33120138000-2 81288462711-6 08013618155-1');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'BOLETO', valid: true });
    expect((found[0] as BoletoFinding).boleto).toMatchObject({ kind: 'arrecadacao', amountCents: 13312 });
  });
});

describe('glued to the label', () => {
  it('CPF right after "CPF" with no space', () => {
    const [f] = extractDocuments('Pagador: Fulana CPF529.982.247-25') as DocFinding[];
    expect(f).toMatchObject({ type: 'CPF', valid: true, raw: '529.982.247-25' });
  });
});
