import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreakerService } from './circuit-breaker.service';
import type { CircuitBreakerConfig } from '@config/ai.config';

function makeConfig(overrides: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return {
    failureThreshold: 3,
    errorRateThreshold: 50,
    windowMs: 60_000,
    openTimeoutMs: 30_000,
    halfOpenProbes: 1,
    ...overrides,
  };
}

describe('CircuitBreakerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls while closed', () => {
    const cb = new CircuitBreakerService(makeConfig());
    expect(cb.allow()).toBe(true);
    expect(cb.currentState).toBe('closed');
  });

  it('opens after the failure threshold and rejects calls while open', () => {
    const cb = new CircuitBreakerService(makeConfig({ failureThreshold: 3 }));
    cb.allow();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe('closed');
    expect(cb.allow()).toBe(true);

    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    expect(cb.allow()).toBe(false);
  });

  it('opens by error rate when the rate threshold is exceeded', () => {
    const cb = new CircuitBreakerService(
      makeConfig({ failureThreshold: 10, errorRateThreshold: 50 }),
    );
    // 3 fallos de 6 llamadas = 50% (umbral), total >= failureThreshold? no: 6 < 10.
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe('closed');

    // 4 fallos de 8 llamadas = 50% >= 50 con total >= 10? no. Subimos a total 10.
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
  });

  it('transitions to half_open after the open timeout and allows a probe', () => {
    const cb = new CircuitBreakerService(makeConfig());
    for (let i = 0; i < 3; i++) {
      cb.recordFailure();
    }
    expect(cb.allow()).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    expect(cb.allow()).toBe(true);
    expect(cb.currentState).toBe('half_open');
  });

  it('closes after a successful probe', () => {
    const cb = new CircuitBreakerService(makeConfig());
    for (let i = 0; i < 3; i++) {
      cb.recordFailure();
    }
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    expect(cb.allow()).toBe(true);

    cb.recordSuccess();
    expect(cb.currentState).toBe('closed');
    expect(cb.allow()).toBe(true);
  });

  it('reopens after a failed probe', () => {
    const cb = new CircuitBreakerService(makeConfig());
    for (let i = 0; i < 3; i++) {
      cb.recordFailure();
    }
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    expect(cb.allow()).toBe(true);

    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    expect(cb.allow()).toBe(false);
  });

  it('rolls the failure window after windowMs', () => {
    const cb = new CircuitBreakerService(makeConfig({ failureThreshold: 3 }));
    cb.recordFailure();
    cb.recordFailure();

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(cb.allow()).toBe(true);
    cb.recordFailure();
    expect(cb.currentState).toBe('closed');
  });
});
