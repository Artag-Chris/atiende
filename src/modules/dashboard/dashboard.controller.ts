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
import {
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  EMAIL_SENDER_TOKEN,
} from '@core/tokens';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import type { EmailSenderPort } from '@core/ports/email-sender.port';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChannelRouterService } from '../channels/router/channel-router.service';

const MAX_REPLY_TEXT_LENGTH = 1000;
const MAX_EMAIL_SUBJECT_LENGTH = 200;
const MAX_EMAIL_BODY_LENGTH = 10_000;

/** Extrae el texto legible del content de un mensaje (blocks Anthropic o string). */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && block.type === 'text' ? block.text : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

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
    private readonly channels?: ChannelRouterService,
    @Optional()
    @Inject(EMAIL_SENDER_TOKEN)
    private readonly emailSender?: EmailSenderPort,
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

  @Get('inbound-activity')
  async listInboundActivity(
    @Req() req: Request,
    @Query('businessId') businessId?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const filterBusinessId = user?.role === 'SUPER_ADMIN' ? businessId : user?.businessId;
    const sinceDate =
      since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date(Date.now() - 60_000);
    const limitNum = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);

    const rows = await this.messageRepo.findInboundActivity(filterBusinessId, sinceDate, limitNum);

    const data = rows.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      customerIdentifier: m.customerIdentifier,
      customerName: m.customerName,
      text: extractMessageText(m.content),
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      data,
      latest: data.length > 0 ? data[data.length - 1].createdAt : sinceDate.toISOString(),
    };
  }

  @Get('pending')
  async listPending(
    @Req() req: Request,
    @Query('businessId') businessId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const filterBusinessId = user?.role === 'SUPER_ADMIN' ? businessId : user?.businessId;
    const rows = await this.conversationRepo.findPending(filterBusinessId, {
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    const items = await Promise.all(
      rows.map(async (conversation) => {
        const lastMessages = await this.messageRepo.findRecent(conversation.id, 1);
        return {
          id: conversation.id,
          channel: conversation.channel,
          customerIdentifier: conversation.customerIdentifier,
          customerName: conversation.customerName ?? null,
          status: conversation.status,
          unreadCount: conversation.unreadCount ?? 0,
          lastMessageAt: conversation.lastMessageAt ?? null,
          lastMessageText: extractMessageText(lastMessages[0]?.content),
        };
      }),
    );

    return { data: items, total: items.length };
  }

  @Get('conversations/:id')
  async getConversation(@Param('id') id: string, @Req() req: Request) {
    const conversation = await this.assertAccessible(id, req);
    const messages = await this.messageRepo.findRecent(id, 50);
    return { conversation, messages };
  }

  @Post('conversations/:id/read')
  async markConversationRead(@Param('id') id: string, @Req() req: Request) {
    const conversation = await this.assertAccessible(id, req);
    await this.conversationRepo.resetUnread(conversation.id);
    return { ok: true };
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

    if (!this.channels) {
      throw new ServiceUnavailableException('El canal de mensajería no está habilitado');
    }

    try {
      await this.channels.send(conversation.channel, {
        businessId: conversation.businessId,
        to: conversation.customerIdentifier,
        text,
      });
    } catch (error) {
      this.logger.error(`Human reply send failed: ${error}`);
      throw new ServiceUnavailableException('No se pudo enviar el mensaje');
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

  /**
   * Envío de email desde el dashboard. SOLO accesible por usuarios con JWT
   * (roles ADMIN/SUPER_ADMIN). El agente de chat no tiene ninguna tool que
   * invoque este camino, así que un cliente no puede pedirle que envíe emails.
   */
  @Post('emails/send')
  async sendEmail(
    @Body() body: { to?: string; subject?: string; text?: string },
    @Req() req: Request,
  ) {
    const user = req.user as { businessId: string; role: string } | undefined;

    if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Requires one of: ADMIN, SUPER_ADMIN');
    }

    if (!this.emailSender) {
      throw new ServiceUnavailableException('El servicio de email no está habilitado');
    }

    const to = body?.to?.trim() ?? '';
    const subject = body?.subject?.trim() ?? '';
    const text = body?.text?.trim() ?? '';

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !EMAIL_RE.test(to)) {
      throw new BadRequestException('Se requiere un email destino válido');
    }
    if (!subject) {
      throw new BadRequestException('El asunto no puede estar vacío');
    }
    if (subject.length > MAX_EMAIL_SUBJECT_LENGTH) {
      throw new BadRequestException(`El asunto supera los ${MAX_EMAIL_SUBJECT_LENGTH} caracteres`);
    }
    if (!text) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }
    if (text.length > MAX_EMAIL_BODY_LENGTH) {
      throw new BadRequestException(`El mensaje supera los ${MAX_EMAIL_BODY_LENGTH} caracteres`);
    }

    try {
      const sent = await this.emailSender.send(to, subject, text);
      if (!sent) {
        throw new ServiceUnavailableException(
          'El proveedor de email no está configurado (EMAIL_DOMAINS_CONFIG / RESEND_API_KEY)',
        );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Dashboard email send failed: ${error}`);
      throw new ServiceUnavailableException('No se pudo enviar el email');
    }

    this.logger.log(
      `Email sent from dashboard by role ${user?.role ?? '?'} (businessId ${user?.businessId ?? '?'}) to ${to}`,
    );
    return { ok: true, to };
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
