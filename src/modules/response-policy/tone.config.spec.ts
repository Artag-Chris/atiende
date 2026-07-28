import { describe, it, expect } from 'vitest';
import { buildTonePrompt, HALLUCINATION_PREVENTION_PROMPT, SCOPE_PROMPT, TONE_PRESETS } from './tone.config';

describe('buildTonePrompt', () => {
  it('generates warm tone for friendly preset', () => {
    const prompt = buildTonePrompt(TONE_PRESETS.friendly);
    expect(prompt).toContain('cálido');
    expect(prompt).toContain('de "tú"');
  });

  it('generates formal tone for professional preset', () => {
    const prompt = buildTonePrompt(TONE_PRESETS.professional);
    expect(prompt).toContain('de "usted"');
    expect(prompt).toContain('profesional');
  });

  it('includes proactive question when proactiveness >= 0.6', () => {
    const prompt = buildTonePrompt(TONE_PRESETS.warm_support);
    expect(prompt).toContain('algo más');
  });

  it('never includes emoji instruction', () => {
    const prompt = buildTonePrompt(TONE_PRESETS.friendly);
    expect(prompt).toContain('Nunca uses emojis');
  });
});

describe('HALLUCINATION_PREVENTION_PROMPT', () => {
  it('contains key anti-hallucination rules', () => {
    expect(HALLUCINATION_PREVENTION_PROMPT).toContain('NUNCA inventes');
    expect(HALLUCINATION_PREVENTION_PROMPT).toContain('No especules');
  });
});

describe('SCOPE_PROMPT', () => {
  it('contains business scope placeholder', () => {
    expect(SCOPE_PROMPT).toContain('[nombre del negocio]');
  });
});
