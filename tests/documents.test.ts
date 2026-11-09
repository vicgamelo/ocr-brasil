// Same cases as mcp-server-brasil/tests/test_documents.py and vgmelo.tech/tests/demos.test.ts.
import { describe, expect, it } from 'vitest';
import { checkCnpj, checkCpf } from '../src/documents.ts';

describe('CNPJ', () => {
  it.each(['11.222.333/0001-81', '00000000000191', '12.ABC.345/01DE-35', '12abc34501de35'])('valid %s', (v) => {
    expect(checkCnpj(v).valid).toBe(true);
  });

  it.each(['11.222.333/0001-82', '12.ABC.345/01DE-36', '00000000000000', '1122233300018', '12ABC34501DEAB'])(
    'invalid %s',
    (v) => expect(checkCnpj(v).valid).toBe(false),
  );

  it('formats, flags alphanumeric and gives the expected digits', () => {
    expect(checkCnpj('12abc34501de35')).toMatchObject({ formatted: '12.ABC.345/01DE-35', alphanumeric: true });
    expect(checkCnpj('11.222.333/0001-82').expected).toBe('81');
    expect(checkCnpj('11222333000181').alphanumeric).toBe(false);
  });
});

describe('CPF', () => {
  it.each(['529.982.247-25', '11144477735'])('valid %s', (v) => expect(checkCpf(v).valid).toBe(true));
  it.each(['529.982.247-24', '111.111.111-11', '1234567890'])('invalid %s', (v) => expect(checkCpf(v).valid).toBe(false));

  it('gives the expected digits when the second one is wrong', () => {
    expect(checkCpf('529.982.247-24')).toMatchObject({ expected: '25', formatted: '529.982.247-24' });
    expect(checkCpf('529.982.247-35').expected).toBe('25');
  });
});
