import { Injectable, Logger, Inject } from '@nestjs/common';
import { CONVERSATION_REPOSITORY_TOKEN } from '@core/tokens';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';

/**
 * Cierra escalaciones inactivas. Se dispara periódicamente desde
 * MaintenanceProcessor (colas MAINTENANCE, repeatable job cada
 * ESCALATION_EXPIRY_INTERVAL_HOURS).
 */
@Injectable()
export class ExpireEscalationsUseCase {
  private readonly logger = new Logger(ExpireEscalationsUseCase.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY_TOKEN)
    private readonly conversationRepo: ConversationRepositoryPort,
  ) {}

  /** Devuelve cuántas conversaciones pasaron de ESCALATED a ACTIVE. */
  async execute(cutoff: Date): Promise<number> {
    const expired = await this.conversationRepo.expireEscalated(cutoff);
    if (expired > 0) {
      this.logger.log(
        `Expired ${expired} escalated conversation(s) inactive since ${cutoff.toISOString()}`,
      );
    }
    return expired;
  }
}
