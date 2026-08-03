import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmailCallScheduler } from './email-call-scheduler.service';
import type { CallRequestRepositoryPort } from '@core/ports/call-request-repository.port';
import type { EmailSenderPort } from '@core/ports/email-sender.port';

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    get: vi.fn((key: string) => {
      // Los overrides tienen prioridad; si el override dice undefined, devuelve undefined.
      if (overrides && key in overrides) return (overrides as Record<string, unknown>)[key];
      if (key === 'SCHEDULING_NOTIFY_EMAIL') return 'equipo@lumenxlabs.com.co';
      if (key === 'NOTIFICATIONS_FROM_EMAIL') return 'noreply@lumenxlabs.com.co';
      return undefined;
    }),
  } as unknown as ConfigService;
}

function createScheduler(overrides?: {
  repo?: Partial<CallRequestRepositoryPort>;
  email?: Partial<EmailSenderPort>;
  config?: Record<string, unknown>;
}) {
  const repo = {
    save: vi.fn().mockImplementation((input: { dedupKey: string }) => ({
      id: 'call-1',
      ...input,
      status: 'PENDING',
      createdAt: new Date(),
    })),
    findLatestForCustomer: vi.fn(),
    ...overrides?.repo,
  } as unknown as CallRequestRepositoryPort;

  const email = {
    send: vi.fn().mockResolvedValue(true),
    ...overrides?.email,
  } as unknown as EmailSenderPort;

  return new EmailCallScheduler(makeConfig(overrides?.config), repo, email);
}

const input = {
  businessId: 'biz-1',
  conversationId: 'conv-1',
  customerIdentifier: '573001234567',
  channel: 'whatsapp' as const,
  preferredTime: 'mañana a las 3pm',
};

describe('EmailCallScheduler', () => {
  let scheduler: EmailCallScheduler;

  beforeEach(() => {
    scheduler = createScheduler();
  });

  it('saves the call request and sends the notification email', async () => {
    const repo = {
      save: vi.fn().mockResolvedValue({
        id: 'call-1',
        status: 'PENDING',
        createdAt: new Date(),
        ...input,
        dedupKey: 'x',
      }),
      findLatestForCustomer: vi.fn(),
    } as unknown as CallRequestRepositoryPort;
    const email = { send: vi.fn().mockResolvedValue(true) } as unknown as EmailSenderPort;
    scheduler = new EmailCallScheduler(makeConfig(), repo, email);

    const result = await scheduler.requestCall(input);

    expect(result.id).toBe('call-1');
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith(
      'equipo@lumenxlabs.com.co',
      expect.stringContaining('Nueva solicitud de llamada'),
      expect.stringContaining('mañana a las 3pm'),
    );
  });

  it('is idempotent: same request (normalized preferredTime) yields the same dedupKey', async () => {
    const save = vi.fn().mockResolvedValue({
      id: 'call-1',
      status: 'PENDING',
      createdAt: new Date(),
      ...input,
      dedupKey: 'same',
    });
    const email = { send: vi.fn().mockResolvedValue(true) } as unknown as EmailSenderPort;
    const repo = { save, findLatestForCustomer: vi.fn() } as unknown as CallRequestRepositoryPort;
    scheduler = new EmailCallScheduler(makeConfig(), repo, email);

    await scheduler.requestCall(input);
    await scheduler.requestCall({ ...input, preferredTime: '  MAÑANA A LAS 3PM  ' });

    const keys = save.mock.calls.map((c) => (c[0] as { dedupKey: string }).dedupKey);
    expect(keys[0]).toBe(keys[1]); // normaliza trim + lowercase
  });

  it('normalizes am/pm in preferredTime so "3pm" and "3 pm" share the same dedupKey', async () => {
    const save = vi.fn().mockResolvedValue({
      id: 'call-1',
      status: 'PENDING',
      createdAt: new Date(),
      ...input,
      dedupKey: 'same',
    });
    const email = { send: vi.fn().mockResolvedValue(true) } as unknown as EmailSenderPort;
    const repo = { save, findLatestForCustomer: vi.fn() } as unknown as CallRequestRepositoryPort;
    scheduler = new EmailCallScheduler(makeConfig(), repo, email);

    await scheduler.requestCall({ ...input, preferredTime: 'mañana a las 3pm' });
    await scheduler.requestCall({ ...input, preferredTime: 'mañana a las 3 pm' });

    const keys = save.mock.calls.map((c) => (c[0] as { dedupKey: string }).dedupKey);
    expect(keys[0]).toBe(keys[1]); // el am/pm no genera duplicados
  });

  it('keeps the call request saved even if the email fails', async () => {
    const repo = {
      save: vi.fn().mockResolvedValue({
        id: 'call-1',
        status: 'PENDING',
        createdAt: new Date(),
        ...input,
        dedupKey: 'x',
      }),
      findLatestForCustomer: vi.fn(),
    } as unknown as CallRequestRepositoryPort;
    const email = {
      send: vi.fn().mockRejectedValue(new Error('Resend 500')),
    } as unknown as EmailSenderPort;
    scheduler = new EmailCallScheduler(makeConfig(), repo, email);

    const result = await scheduler.requestCall(input);

    expect(result.id).toBe('call-1'); // el lead no se pierde
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('falls back to NOTIFICATIONS_FROM_EMAIL when SCHEDULING_NOTIFY_EMAIL is not set', async () => {
    const repo = {
      save: vi.fn().mockResolvedValue({
        id: 'call-1',
        status: 'PENDING',
        createdAt: new Date(),
        ...input,
        dedupKey: 'x',
      }),
      findLatestForCustomer: vi.fn(),
    } as unknown as CallRequestRepositoryPort;
    const email = { send: vi.fn().mockResolvedValue(true) } as unknown as EmailSenderPort;
    scheduler = new EmailCallScheduler(
      makeConfig({ SCHEDULING_NOTIFY_EMAIL: undefined }),
      repo,
      email,
    );

    const result = await scheduler.requestCall(input);

    expect(result.id).toBe('call-1');
    // Sin SCHEDULING_NOTIFY_EMAIL, notifica al NOTIFICATIONS_FROM_EMAIL.
    expect(email.send).toHaveBeenCalledWith(
      'noreply@lumenxlabs.com.co',
      expect.stringContaining('Nueva solicitud de llamada'),
      expect.any(String),
    );
  });
});
