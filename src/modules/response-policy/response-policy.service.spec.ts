import { describe, it, expect, vi } from 'vitest';
import { ResponsePolicyService } from './response-policy.service';
import { ScopeClassifier } from './scope-classifier.service';
import { ResponseValidator } from './response-validator.service';

describe('ResponsePolicyService', () => {
  function createService(scopeResult: { inScope: boolean; confidence: number }) {
    const scopeClassifier = {
      classify: vi.fn().mockResolvedValue(scopeResult),
    } as unknown as ScopeClassifier;
    const responseValidator = new ResponseValidator();
    return new ResponsePolicyService(scopeClassifier, responseValidator);
  }

  it('allows in-scope messages', async () => {
    const service = createService({ inScope: true, confidence: 0.8 });
    const result = await service.checkScope('biz-1', 'qué laptops tienen?');
    expect(result.allowed).toBe(true);
    expect(result.rejectionMessage).toBeUndefined();
  });

  it('blocks out-of-scope messages with rejection', async () => {
    const service = createService({ inScope: false, confidence: 0.1 });
    const result = await service.checkScope('biz-1', 'quién es Álvaro Uribe?');
    expect(result.allowed).toBe(false);
    expect(result.rejectionMessage).toBeDefined();
    expect(result.rejectionMessage).toContain('Lo siento');
  });

  it('includes business name in rejection message', async () => {
    const service = createService({ inScope: false, confidence: 0.1 });
    const result = await service.checkScope('biz-1', 'quién eres?', 'LumenX Labs');
    expect(result.rejectionMessage).toContain('LumenX Labs');
  });

  it('builds system prompt extras with business name', () => {
    const service = createService({ inScope: true, confidence: 0.8 });
    const extras = service.buildSystemPromptExtras('LumenX Labs');
    expect(extras).toContain('LumenX Labs');
    expect(extras).toContain('NUNCA inventes');
    expect(extras).toContain('cálido');
  });

  it('builds system prompt without business name fallback', () => {
    const service = createService({ inScope: true, confidence: 0.8 });
    const extras = service.buildSystemPromptExtras();
    expect(extras).toContain('el negocio');
  });

  it('validates response through validator', () => {
    const service = createService({ inScope: true, confidence: 0.8 });
    const result = service.validateResponse('', { message: 'hola' });
    expect(result.approved).toBe(false);
  });
});
