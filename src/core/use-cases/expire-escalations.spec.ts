import { describe, it, expect, vi } from 'vitest';
import { ExpireEscalationsUseCase } from './expire-escalations';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';

function createRepo(expired: number) {
  return {
    expireEscalated: vi.fn().mockResolvedValue(expired),
  } as unknown as ConversationRepositoryPort;
}

describe('ExpireEscalationsUseCase', () => {
  it('delegates the cutoff to the repository and returns the count', async () => {
    const repo = createRepo(3);
    const useCase = new ExpireEscalationsUseCase(repo);
    const cutoff = new Date('2026-01-01T00:00:00.000Z');

    const count = await useCase.execute(cutoff);

    expect(repo.expireEscalated).toHaveBeenCalledWith(cutoff);
    expect(count).toBe(3);
  });

  it('returns zero when nothing expired', async () => {
    const repo = createRepo(0);
    const useCase = new ExpireEscalationsUseCase(repo);

    expect(await useCase.execute(new Date())).toBe(0);
  });
});
