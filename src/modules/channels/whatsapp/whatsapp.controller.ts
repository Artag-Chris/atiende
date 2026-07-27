import {
  Controller,
  Get,
  Post,
  Query,
  Headers,
  RawBodyRequest,
  Req,
  Logger,
  UnauthorizedException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { AgentService } from '@core/services/agent.service';
import type { ChannelProviderPort } from '@core/ports/channel-provider.port';
import { CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { BusinessRepository } from '@modules/persistence/postgres/business.repository';
import { ConversationRepository } from '@modules/persistence/postgres/conversation.repository';
import { MessageRepository } from '@modules/persistence/postgres/message.repository';
import { InboundMessageRepository } from '@modules/persistence/postgres/inbound-message.repository';

const DEFAULT_SYSTEM_PROMPT = `Eres Atiende, un asistente conversacional de IA para una tienda. Atiendes clientes por WhatsApp con calidez y eficiencia.

REGLAS:
- Responde en español.
- Sé corto y directo (máximo 2-3 oraciones).
- Si el cliente pregunta por un producto, di que estás buscando en el catálogo.
- Si no sabes algo, di que no tienes esa información.
- Nunca inventes precios o productos.`;

@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;

  constructor(
    configService: ConfigService,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly agentService: AgentService,
    @Inject(CHANNEL_PROVIDERS_TOKEN)
    private readonly channelProviders: ChannelProviderPort[],
    private readonly businessRepo: BusinessRepository,
    private readonly conversationRepo: ConversationRepository,
    private readonly messageRepo: MessageRepository,
    private readonly inboundMessageRepo: InboundMessageRepository,
  ) {
    this.verifyToken = configService.getOrThrow<string>('META_WEBHOOK_VERIFY_TOKEN');
  }

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    this.logger.log(`Webhook verify request: mode=${mode}`);

    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed — token mismatch');
    throw new UnauthorizedException('Verification failed');
  }

  @Post()
  async handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.logger.log('Inbound webhook received');

    const rawBody = req.rawBody?.toString() ?? '';
    if (!rawBody) {
      throw new BadRequestException('Empty body');
    }

    if (!signature) {
      this.logger.warn('Missing x-hub-signature-256 header');
    } else if (!this.whatsapp.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON');
    }

    const messages = this.whatsapp.parseInboundWebhook(parsed);
    this.logger.log(`Parsed ${messages.length} message(s) from webhook`);

    const firstText = messages.find((m) => m.type === 'text' && m.text);
    if (!firstText || !firstText.text) {
      this.logger.debug('No text messages to process');
      return { status: 'ok' };
    }

    this.logger.log(`Processing message from ${firstText.from}: "${firstText.text}"`);

    try {
      const business = await this.businessRepo.findByPhoneId(firstText.externalAccountId);
      if (!business) {
        this.logger.warn(
          `No business found for phone_id=${firstText.externalAccountId}. Processing without persistence.`,
        );
      }

      const conversation = business
        ? await this.conversationRepo.getOrCreate(business.id, 'WHATSAPP', firstText.from)
        : null;

      if (business && conversation) {
        const alreadyExists = await this.inboundMessageRepo.existsByExternalId(
          business.id,
          firstText.externalMessageId,
        );
        if (alreadyExists) {
          this.logger.debug(`Duplicate inbound message ${firstText.externalMessageId}, skipping`);
          return { status: 'ok' };
        }

        await this.inboundMessageRepo.save({
          businessId: business.id,
          rawPayload: firstText.rawPayload as Record<string, unknown>,
          externalMessageId: firstText.externalMessageId,
        });

        await this.messageRepo.save({
          conversationId: conversation.id,
          role: 'USER',
          content: [{ type: 'text', text: firstText.text }],
        });
      }

      const agentResponse = await this.agentService.runTurn({
        systemPrompt: business?.systemPromptExtras
          ? `${DEFAULT_SYSTEM_PROMPT}\n\n${business.systemPromptExtras}`
          : DEFAULT_SYSTEM_PROMPT,
        userMessage: firstText.text,
        persistence:
          business && conversation
            ? { businessId: business.id, conversationId: conversation.id }
            : undefined,
      });

      if (business && conversation) {
        await this.messageRepo.save({
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: [{ type: 'text', text: agentResponse.text }],
          tokenUsage: {
            inputTokens: agentResponse.usage.inputTokens,
            outputTokens: agentResponse.usage.outputTokens,
          },
        });
      }

      this.logger.log(
        `Agent responded: "${agentResponse.text.slice(0, 100)}..." (${agentResponse.latencyMs}ms, $${agentResponse.costUsd.toFixed(6)})`,
      );

      const whatsapp = this.channelProviders.find((p) => p.name === 'whatsapp');

      if (whatsapp) {
        await whatsapp.send({
          businessId: firstText.externalAccountId,
          to: firstText.from,
          text: agentResponse.text,
        });
        this.logger.log(`Response sent to ${firstText.from}`);
      }
    } catch (error) {
      this.logger.error(`Error processing message: ${error}`);
    }

    return { status: 'ok' };
  }
}
