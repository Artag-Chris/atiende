import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { MaintenanceProcessor } from './maintenance.processor';
import { ExpireEscalationsUseCase } from '@core/use-cases/expire-escalations';

function createConfig() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'ESCALATION_EXPIRY_HOURS') return 72;
      if (key === 'ESCALATION_EXPIRY_INTERVAL_HOURS') return 6;
      return undefined;
    }),
  } as unknown as ConfigService;
}

function createJob(name: string): Job {
  return { name } as unknown as Job;
}

describe('MaintenanceProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expires escalations using the configured inactivity window', async () => {
    const expireEscalations = {
      execute: vi.fn().mockResolvedValue(2),
    } as unknown as ExpireEscalationsUseCase;
    const processor = new MaintenanceProcessor(expireEscalations, createConfig());
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await processor.process(createJob('expire-escalations'));

    expect(expireEscalations.execute).toHaveBeenCalledTimes(1);
    const cutoff = vi.mocked(expireEscalations.execute).mock.calls[0][0] as Date;
    expect(cutoff.getTime()).toBe(now - 72 * 60 * 60 * 1000);
  });

  it('ignores unknown maintenance jobs', async () => {
    const expireEscalations = { execute: vi.fn() } as unknown as ExpireEscalationsUseCase;
    const processor = new MaintenanceProcessor(expireEscalations, createConfig());

    await processor.process(createJob('unknown-job'));

    expect(expireEscalations.execute).not.toHaveBeenCalled();
  });
});
