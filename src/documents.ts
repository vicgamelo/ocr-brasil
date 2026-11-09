// CPF and CNPJ check digits. Same rule as mcp-server-brasil (src/mcp_server_brasil/documents.py)
// and the vgmelo.tech CNPJ demo, with the same test cases.
// Alphanumeric CNPJ (IN RFB 2.229/2024): the first 12 positions accept A-Z and each character is
// worth ord(c) - 48 in the mod 11 sum, so "0".."9" keep their value.

const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export interface DocCheck {
  kind: 'CPF' | 'CNPJ';
  valid: boolean;
  /** Normalized value: digits for CPF, uppercase 0-9A-Z for CNPJ. */
  value: string;
  formatted: string;
  alphanumeric: boolean;
  /** The two check digits the rule expects, when the shape is right. */
  expected: string | null;
}

function cnpjDigit(chars: string, weights: number[]): number {
  let total = 0;
  for (let i = 0; i < chars.length; i++) total += (chars.charCodeAt(i) - 48) * weights[i];
  const rest = total % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export const formatCnpj = (v: string) => `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
export const formatCpf = (v: string) => `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;

export function checkCnpj(input: string): DocCheck {
  const v = input.replace(/[.\-/\s]/g, '').toUpperCase();
  const base = { kind: 'CNPJ' as const, value: v, formatted: formatCnpj(v), alphanumeric: /[A-Z]/.test(v) };
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(v) || new Set(v).size === 1) return { ...base, valid: false, expected: null };
  const d1 = cnpjDigit(v.slice(0, 12), W1);
  const d2 = cnpjDigit(v.slice(0, 12) + d1, W2);
  const expected = `${d1}${d2}`;
  return { ...base, valid: v.slice(12) === expected, expected };
}

export function checkCpf(input: string): DocCheck {
  const v = input.replace(/\D/g, '');
  const base = { kind: 'CPF' as const, value: v, formatted: formatCpf(v), alphanumeric: false };
  if (v.length !== 11 || new Set(v).size === 1) return { ...base, valid: false, expected: null };
  let expected = '';
  for (const size of [9, 10]) {
    let total = 0;
    const digits = v.slice(0, 9) + expected;
    for (let i = 0; i < size; i++) total += Number(digits[i]) * (size + 1 - i);
    expected += String(((total * 10) % 11) % 10);
  }
  return { ...base, valid: v.slice(9) === expected, expected };
}
