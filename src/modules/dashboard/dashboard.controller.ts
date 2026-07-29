import { Controller, Get, Param, Inject, Query, Logger, NotFoundException } from '@nestjs/common';
import { CONVERSATION_REPOSITORY_TOKEN, MESSAGE_REPOSITORY_TOKEN } from '@core/tokens';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';

@Controller('api/dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY_TOKEN)
    private readonly conversationRepo: ConversationRepositoryPort,
    @Inject(MESSAGE_REPOSITORY_TOKEN)
    private readonly messageRepo: MessageRepositoryPort,
  ) {}

  @Get('escalations')
  async listEscalations(
    @Query('businessId') businessId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const rows = await this.conversationRepo.findEscalated(businessId, {
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    return { data: rows, total: rows.length };
  }

  @Get('conversations/:id')
  async getConversation(@Param('id') id: string) {
    const conversation = await this.conversationRepo.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');

    const messages = await this.messageRepo.findRecent(id, 50);
    return { conversation, messages };
  }
}
