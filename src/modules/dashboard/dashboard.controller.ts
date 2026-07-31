import {
  Controller,
  Get,
  Post,
  Param,
  Inject,
  Body,
  Optional,
  Query,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CONVERSATION_REPOSITORY_TOKEN, MESSAGE_REPOSITORY_TOKEN } from '@core/tokens';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WhatsAppAdapter } from '../channels/whatsapp/whatsapp.adapter';

const MAX_REPLY_TEXT_LENGTH = 1000;

@UseGuards(JwtAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY_TOKEN)
    private readonly conversationRepo: ConversationRepositoryPort,
    @Inject(MESSAGE_REPOSITORY_TOKEN)
    private readonly messageRepo: MessageRepositoryPort,
    @Optional()
    private readonly whatsapp?: WhatsAppAdapter,
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
    const conversation = await this.assertAccessible(id, req);
    const messages = await this.messageRepo.findRecent(id, 50);
    return { conversation, messages };
  }

  /**
   * Respuesta humana desde el dashboard. Solo se permite en conversaciones
   * ESCALATED para evitar que humano e IA respondan a la vez.
   */
  @Post('conversations/:id/send')
  async sendHumanReply(
    @Param('id') id: string,
    @Body() body: { text?: string },
    @Req() req: Request,
  ) {
    const conversation = await this.assertAccessible(id, req);

    if (conversation.status !== 'ESCALATED') {
      throw new ConflictException('La conversación no está escalada a un humano');
    }

    const rawText = body?.text;
    if (typeof rawText !== 'string') {
      throw new BadRequestException('El mensaje debe ser un texto');
    }
    const text = rawText.trim();
    if (!text) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }
    if (text.length > MAX_REPLY_TEXT_LENGTH) {
      throw new BadRequestException(`El mensaje supera los ${MAX_REPLY_TEXT_LENGTH} caracteres`);
    }

    if (!this.whatsapp) {
      throw new ServiceUnavailableException('El canal de WhatsApp no está habilitado');
    }

    try {
      await this.whatsapp.send({
        businessId: conversation.businessId,
        to: conversation.customerIdentifier,
        text,
      });
    } catch (error) {
      this.logger.error(`Human reply send failed: ${error}`);
      throw new ServiceUnavailableException('No se pudo enviar el mensaje de WhatsApp');
    }

    // Send-then-persist: si el send falla no se guarda nada; si el persist
    // falla tras un send exitoso, un reintento del cliente lo dejará visible.
    await this.messageRepo.save({
      conversationId: conversation.id,
      role: 'HUMAN',
      content: [{ type: 'text', text }],
    });
    await this.conversationRepo.touchLastMessage(conversation.id);

    return { ok: true };
  }

  @Post('conversations/:id/resolve')
  async resolveConversation(@Param('id') id: string, @Req() req: Request) {
    const conversation = await this.assertAccessible(id, req);
    await this.conversationRepo.updateStatus(conversation.id, 'RESOLVED');
    return { ok: true };
  }

  /** Carga la conversación validando 404 + scope de tenant (SUPER_ADMIN omite). */
  private async assertAccessible(id: string, req: Request) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const conversation = await this.conversationRepo.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (user?.role !== 'SUPER_ADMIN' && conversation.businessId !== user?.businessId) {
      throw new ForbiddenException('Access denied to this conversation');
    }

    return conversation;
  }
}
