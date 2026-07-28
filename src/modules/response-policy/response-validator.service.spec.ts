import { describe, it, expect } from 'vitest';
import { ResponseValidator } from './response-validator.service';

describe('ResponseValidator', () => {
  const validator = new ResponseValidator();

  it('approves a normal response', () => {
    const result = validator.validate(
      'Claro, tenemos laptops gaming desde $800. ¿Te gustaría ver más detalles?',
      { message: 'qué laptops tienen?' },
    );
    expect(result.approved).toBe(true);
  });

  it('rejects empty response', () => {
    const result = validator.validate('', { message: 'hola' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('Respuesta vacía');
  });

  it('rejects response with "no tengo información... pero" pattern', () => {
    const result = validator.validate(
      'No tengo información sobre eso, pero creo que podría ser así...',
      { message: 'algo' },
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('alucinación');
  });

  it('provides modified response when hallucination detected', () => {
    const result = validator.validate(
      'No tengo información sobre el precio, pero según mi conocimiento cuesta $500',
      { message: 'precio?', businessName: 'MiNegocio' },
    );
    expect(result.approved).toBe(false);
    expect(result.modified).toContain('MiNegocio');
  });

  it('passes valid business response', () => {
    const result = validator.validate(
      'El producto tiene garantía de 12 meses según nuestra política de devoluciones.',
      { message: 'garantía?', businessName: 'LumenX Labs' },
    );
    expect(result.approved).toBe(true);
  });
});
