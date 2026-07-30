import {
  Controller,
  Get,
  Param,
  Inject,
  Query,
  Logger,
  NotFoundException,
  ForbiddenException,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CONVERSATION_REPOSITORY_TOKEN, MESSAGE_REPOSITORY_TOKEN } from '@core/tokens';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
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
    @Req() req: Request,
    @Query('businessId') businessId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const filterBusinessId = user?.role === 'SUPER_ADMIN' ? businessId : user?.businessId;
    const rows = await this.conversationRepo.findEscalated(filterBusinessId, {
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    return { data: rows, total: rows.length };
  }

  @Get('conversations/:id')
  async getConversation(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const conversation = await this.conversationRepo.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (user?.role !== 'SUPER_ADMIN' && conversation.businessId !== user?.businessId) {
      throw new ForbiddenException('Access denied to this conversation');
    }

    const messages = await this.messageRepo.findRecent(id, 50);
    return { conversation, messages };
  }
}
