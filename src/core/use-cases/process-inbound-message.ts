import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { AgentService } from '@core/services/agent.service';
import type { AgentRunRepositoryPort } from '@core/ports/agent-run-repository.port';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { ConversationData } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { UnitOfWorkPort } from '@core/ports/unit-of-work.port';
import type { ChatMessage, TurnContext, Channel } from '@core/domain/types';
import type { ResponsePolicyPort } from '@core/ports/response-policy.port';
import type { ResponseCachePort } from '@core/ports/response-cache.port';
import {
  AGENT_RUN_REPOSITORY_TOKEN,
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  BUSINESS_REPOSITORY_TOKEN,
  RESPONSE_POLICY_TOKEN,
  EXACT_CACHE_TOKEN,
  SEMANTIC_CACHE_TOKEN,
  UNIT_OF_WORK_TOKEN,
} from '@core/tokens';

const DEFAULT_SYSTEM_PROMPT = `Eres un asistente conversacional de IA. Atiendes clientes por WhatsApp con calidez y eficiencia.

HERRAMIENTAS DISPONIBLES:
- get_business_info: usa esta tool cuando el cliente pregunte por horarios, ubicación, servicios o información general del negocio.
- search_catalog: usa esta tool cuando el cliente busque productos, pregunte por precios, o quiera recomendaciones. Busca semánticamente en el catálogo.
- get_product: usa esta tool cuando necesites ver el detalle completo de un producto específico que ya encontraste.
- create_order: usa esta tool cuando el cliente quiera comprar algo o hacer un pedido. Confirma stock antes de crear.
- search_knowledge: usa esta tool cuando el cliente pregunte por políticas de devolución, garantías, métodos de pago, horarios, envíos, o cualquier información que no esté en el catálogo de productos. Busca en documentos de conocimiento (FAQs, políticas, manuales).
- escalate_to_human: usa esta tool cuando el cliente pida hablar con una persona real, tenga una queja, o necesite soporte especializado.
- estimate_price: usa esta tool SIEMPRE que el cliente pida una cotización, presupuesto o precio de servicios de LumenX (desarrollo web, agente IA, automatización, etc.). Pásale los servicios que el cliente menciona en su idioma (ej: "desarrollo web", "chatbot", "automatización") y la plataforma si la menciona (ej: "AWS", "Neon", "Vercel"). La tool devuelve el total en COP o USD según el idioma. NUNCA inventes ni calcules precios por tu cuenta.
- get_quote: usa esta tool cuando el cliente pregunte por su cotización anterior ("cuál fue mi cotización", "cuánto me cotizaste").

REGLAS:
- Responde en el idioma del cliente (español o inglés).
- Usa las herramientas cuando sea apropiado antes de responder.
- Nunca inventes precios, productos o servicios que no estén en las herramientas.
- Para cotizaciones de servicios, SIEMPRE usa estimate_price y presenta el total que devuelve la tool (en la moneda que indique). Preséntalo como un ESTIMADO, no como precio final: usa frases como "aproximadamente", "está alrededor de", "una estimación inicial de", y aclara que el precio final depende de los detalles del proyecto. No digas rangos ni números que no vengan de la tool.
- Si el cliente solicita algo fuera de tu alcance, escala a un humano.`;

export interface InboundMessage {
  channel: Channel;
  externalAccountId: string;
  from: string;
  text: string;
  externalMessageId: string;
  rawPayload: Record<string, unknown>;
  customerName?: string;
}

export interface ProcessResult {
  responded: boolean;
  responseText?: string;
  error?: string;
  inboundMessageId?: string | null;
  /** Business que atendió el mensaje (para el send saliente por canal). */
  businessId?: string;
  /** Motivo por el que el pipeline no respondió (p.ej. conversación escalada). */
  skipReason?: 'escalated' | string;
}

@Injectable()
export class ProcessInboundMessageUseCase {
  private readonly logger = new Logger(ProcessInboundMessageUseCase.name);

  constructor(
    private readonly agentService: AgentService,
    @Inject(AGENT_RUN_REPOSITORY_TOKEN) private readonly agentRunRepo: AgentRunRepositoryPort,
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
    @Inject(CONVERSATION_REPOSITORY_TOKEN)
    private readonly conversationRepo: ConversationRepositoryPort,
    @Inject(MESSAGE_REPOSITORY_TOKEN) private readonly messageRepo: MessageRepositoryPort,
    @Inject(INBOUND_MESSAGE_REPOSITORY_TOKEN)
    private readonly inboundMessageRepo: InboundMessageRepositoryPort,
    @Inject(UNIT_OF_WORK_TOKEN) private readonly unitOfWork: UnitOfWorkPort,
    @Optional() @Inject(RESPONSE_POLICY_TOKEN) private readonly responsePolicy?: ResponsePolicyPort,
    @Optional() @Inject(EXACT_CACHE_TOKEN) private readonly exactCache?: ResponseCachePort,
    @Optional() @Inject(SEMANTIC_CACHE_TOKEN) private readonly semanticCache?: ResponseCachePort,
  ) {
    if (!this.exactCache) this.logger.warn('EXACT_CACHE_TOKEN not provided — exact cache disabled');
    if (!this.semanticCache)
      this.logger.warn('SEMANTIC_CACHE_TOKEN not provided — semantic cache disabled');
  }

  async execute(message: InboundMessage): Promise<ProcessResult> {
    this.logger.log(`Processing message from ${message.from}: "${message.text}"`);

    const business = await this.businessRepo.findByChannelAccount(
      message.channel,
      message.externalAccountId,
    );
    if (!business) {
      // Poison-pill: sin business no hay tenant del que responder. Antes esto
      // corría el LLM y el processor lanzaba "no businessId to send" → el job
      // se reintentaba hasta agotar (coste de tokens + ruido). Early return:
      // el job completa sin efecto, sin LLM.
      this.logger.warn(
        `No business found for channel=${message.channel} account=${message.externalAccountId}. Skipping message.`,
      );
      return { responded: false, skipReason: 'no_business' };
    }

    if (business && this.responsePolicy) {
      try {
        const scope = await this.responsePolicy.checkScope(
          business.id,
          message.text,
          business.name ?? undefined,
        );
        if (!scope.allowed) {
          // El webhook ya persistió el inbound (persist-before-enqueue). Lo
          // devolvemos para que el processor envíe la respuesta y luego lo
          // marque processed (at-least-once). Si no existe (job inyectado
          // directamente), lo guardamos para no dejar huecos de trazabilidad.
          let blockedInboundId: string | null = null;
          try {
            let existing = await this.inboundMessageRepo.findByExternalId(
              business.id,
              message.externalMessageId,
            );
            if (!existing) {
              existing = await this.inboundMessageRepo.save({
                businessId: business.id,
                rawPayload: message.rawPayload,
                externalMessageId: message.externalMessageId,
              });
            }
            blockedInboundId = existing.id;
          } catch (error) {
            this.logger.warn(`Failed to persist inbound for blocked message: ${error}`);
          }
          this.logger.log(`Out-of-scope message blocked: "${message.text.slice(0, 60)}..."`);
          return {
            responded: true,
            responseText: scope.rejectionMessage,
            inboundMessageId: blockedInboundId,
            businessId: business.id,
          };
        }
      } catch (error) {
        this.logger.warn(`Scope check failed (allowing message through): ${error}`);
      }
    }

    let conversation: ConversationData | null = null;
    let inboundMsgId: string | null = null;

    if (business) {
      // Esqueleto atómico del pipeline: conversation + dedup + inbound + USER
      // message en un solo commit. Un crash a mitad NO deja estado parcial.
      const result = await this.unitOfWork.withTransaction(async (ctx) => {
        const convo = await ctx.conversationRepo.getOrCreate(
          business.id,
          message.channel,
          message.from,
          message.customerName,
        );

        if (convo.status === 'RESOLVED') {
          // Un mensaje entrante tras resolver reabre la conversación para que
          // vuelva a aparecer en pendientes del dashboard.
          await ctx.conversationRepo.updateStatus(convo.id, 'ACTIVE');
        }

        const existing = await ctx.inboundMessageRepo.findByExternalId(
          business.id,
          message.externalMessageId,
        );
        if (existing?.processedAt) {
          this.logger.debug(
            `Inbound message ${message.externalMessageId} already processed, skipping`,
          );
          return { alreadyProcessed: true, convo, inboundMsgId: existing.id };
        }

        // El webhook ya pudo persistir el inbound (persist-before-enqueue).
        let inboundId: string;
        if (existing) {
          inboundId = existing.id;
        } else {
          const saved = await ctx.inboundMessageRepo.save({
            businessId: business.id,
            rawPayload: message.rawPayload,
            externalMessageId: message.externalMessageId,
          });
          inboundId = saved.id;
        }

        const savedUser = await ctx.messageRepo.save({
          conversationId: convo.id,
          role: 'USER',
          content: [{ type: 'text', text: message.text }],
          inboundMessageId: inboundId,
        });

        // Solo la primera vez que se persiste este USER message (idempotente
        // ante reintentos del job): el mensaje entrante queda sin leer.
        if (savedUser.created) {
          await ctx.conversationRepo.incrementUnread(convo.id);
        }

        return { alreadyProcessed: false, convo, inboundMsgId: inboundId };
      });

      if (result.alreadyProcessed) return { responded: false };
      conversation = result.convo;
      inboundMsgId = result.inboundMsgId;
    }

    if (conversation?.status === 'ESCALATED') {
      // Human takeover: el mensaje entrante ya quedó persistido como USER.
      // La IA queda muda; un humano atiende desde el dashboard. Al expirar la
      // escalación (MaintenanceModule) la conversación vuelve a ACTIVE y la IA
      // retoma.
      this.logger.log(
        `Conversation ${conversation.id} is ESCALATED — message queued for human, AI paused`,
      );
      return { responded: false, skipReason: 'escalated', inboundMessageId: inboundMsgId };
    }

    const conversationHistory = conversation
      ? await this.loadConversationHistory(conversation.id)
      : undefined;

    const systemPrompt = this.buildSystemPrompt(
      business?.systemPromptExtras,
      business?.name ?? undefined,
    );

    const hasPII = this.hasPII(message.text);

    const cacheLayers = [this.exactCache, this.semanticCache].filter(
      Boolean,
    ) as ResponseCachePort[];

    if (business && conversation) {
      const turnCtx: TurnContext = {
        businessId: business.id,
        conversationId: conversation.id,
        customerPhone: message.from,
        channel: message.channel,
        historyLength: conversationHistory?.length ?? 0,
        hasPersonalInfo: hasPII,
        // Pre-lookup: si el mensaje parece pedir cotización/precio, bypassear el
        // cache (puede haber una cotización distinta por cliente o precios viejos).
        mayInvolveStatefulTool: this.looksLikeQuoteRequest(message.text),
        businessConfig: {},
      };

      for (const cache of cacheLayers) {
        const cached = await cache.lookup(message.text, turnCtx).catch((err: Error) => {
          this.logger.warn(`${cache.name} cache lookup error: ${err.message}`);
          return null;
        });
        if (cached) {
          let cachedText = cached.responseText;
          if (this.responsePolicy) {
            const validation = this.responsePolicy.validateResponse(cachedText, {
              message: message.text,
              businessName: business?.name ?? undefined,
            });
            if (!validation.approved) {
              cachedText = validation.modified ?? cachedText;
              this.logger.warn(`Cached response validation failed: ${validation.reason}`);
            }
          }
          if (inboundMsgId) {
            this.logger.debug(
              `Cached response for inbound message ${inboundMsgId} (marked processed after send)`,
            );
          }
          this.logger.log(`${cache.name} cache HIT for business=${business.id}`);
          if (conversation) {
            await this.conversationRepo
              .resetUnread(conversation.id)
              .catch((err: unknown) => this.logger.warn(`Failed to reset unread: ${err}`));
          }
          return {
            responded: true,
            responseText: cachedText,
            inboundMessageId: inboundMsgId,
            businessId: business.id,
          };
        }
      }
    }

    const agentResponse = await this.agentService.runTurn({
      systemPrompt,
      userMessage: message.text,
      conversationHistory,
      persistence:
        business && conversation
          ? { businessId: business.id, conversationId: conversation.id }
          : undefined,
      turnContext: {
        customerPhone: message.from,
        channel: message.channel,
      },
    });

    let finalText = agentResponse.text;

    if (this.responsePolicy) {
      const validation = this.responsePolicy.validateResponse(finalText, {
        message: message.text,
        businessName: business?.name ?? undefined,
      });
      if (!validation.approved) {
        finalText = validation.modified ?? finalText;
        this.logger.warn(`Response validation failed: ${validation.reason}`);
      }
    }

    if (business && conversation) {
      const turnCtx: TurnContext = {
        businessId: business.id,
        conversationId: conversation.id,
        customerPhone: message.from,
        channel: message.channel,
        historyLength: conversationHistory?.length ?? 0,
        hasPersonalInfo: hasPII,
        // Tools que persisten estado o devuelven datos privados: el turno no
        // debe cachearse (cotización vieja con precios desactualizados, o
        // fuga de la cotización de otro cliente).
        mayInvolveStatefulTool: agentResponse.toolCallsMade.some(
          (t) =>
            t.name === 'create_order' ||
            t.name === 'escalate_to_human' ||
            t.name === 'estimate_price' ||
            t.name === 'get_quote',
        ),
        businessConfig: {},
      };
      const cacheable = { responseText: finalText, toolCalls: agentResponse.toolCallsMade };
      for (const cache of cacheLayers) {
        cache
          .store(message.text, cacheable, turnCtx)
          .catch((err: Error) =>
            this.logger.warn(`${cache.name} cache store error: ${err.message}`),
          );
      }
    }

    if (business && conversation) {
      const escalated = agentResponse.toolCallsMade.some((t) => t.name === 'escalate_to_human');
      if (escalated) {
        const escalationToolCall = agentResponse.toolCallsMade.find(
          (t) => t.name === 'escalate_to_human',
        );
        const input = escalationToolCall?.input as Record<string, unknown> | undefined;
        const reason = input?.reason as string | undefined;
        const urgency = input?.urgency as string | undefined;
        await this.conversationRepo
          .updateStatus(conversation.id, 'ESCALATED', {
            escalationReason: reason,
            urgency: urgency?.toUpperCase(),
          })
          .catch((err: unknown) => this.logger.warn(`Failed to persist escalation status: ${err}`));
      }
    }

    if (business && conversation) {
      await this.messageRepo.save({
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: [{ type: 'text', text: finalText }],
        tokenUsage: {
          inputTokens: agentResponse.usage.inputTokens,
          outputTokens: agentResponse.usage.outputTokens,
          toolCalls: agentResponse.toolCallsMade,
        },
      });

      // La IA respondió: el chat deja de ser pendiente (requiere atención
      // humana solo si sigue sin resolver tras la respuesta del agente).
      await this.conversationRepo
        .resetUnread(conversation.id)
        .catch((err: unknown) => this.logger.warn(`Failed to reset unread: ${err}`));
    }

    if (inboundMsgId) {
      this.logger.debug(
        `Inbound message ${inboundMsgId} will be marked processed after the send succeeds`,
      );
    }

    this.logger.log(
      `Agent responded: "${finalText.slice(0, 100)}..." (${agentResponse.latencyMs}ms, $${agentResponse.costUsd.toFixed(6)})`,
    );

    return {
      responded: true,
      responseText: finalText,
      inboundMessageId: inboundMsgId,
      businessId: business?.id,
    };
  }

  async markProcessed(inboundMessageId: string): Promise<void> {
    try {
      await this.inboundMessageRepo.markProcessed(inboundMessageId);
    } catch (error: unknown) {
      this.logger.warn(`Failed to mark inbound message as processed: ${error}`);
    }
  }

  private buildSystemPrompt(existingExtras?: string | null, businessName?: string): string {
    const policyExtras = this.responsePolicy?.buildSystemPromptExtras(businessName);

    if (existingExtras) {
      return `${DEFAULT_SYSTEM_PROMPT}\n\n${existingExtras}${policyExtras ? `\n\n${policyExtras}` : ''}`;
    }

    if (policyExtras) {
      return `${DEFAULT_SYSTEM_PROMPT}\n\n${policyExtras}`;
    }

    return DEFAULT_SYSTEM_PROMPT;
  }

  private async loadConversationHistory(conversationId: string): Promise<ChatMessage[]> {
    try {
      const messages = await this.messageRepo.findRecent(conversationId, 20);
      const result: ChatMessage[] = [];

      for (const m of messages) {
        if (m.role === 'USER') {
          const contentBlocks = m.content as Array<{ type: string; text?: string }>;
          const text = contentBlocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('\n');
          if (text.length > 0) {
            result.push({
              role: 'user',
              content: [{ type: 'text', text }],
            });
          }
        } else if (m.role === 'ASSISTANT' || m.role === 'HUMAN') {
          // HUMAN se mapea a rol assistant para preservar la alternancia de
          // roles de la API Anthropic cuando la IA retoma tras resolver.
          const tokenUsage = m.tokenUsage as Record<string, unknown> | undefined;
          const toolCalls =
            (tokenUsage?.toolCalls as Array<{
              name: string;
              input: Record<string, unknown>;
              output: string;
            }>) ?? [];

          if (toolCalls.length > 0) {
            const assistantContent: Array<
              | { type: 'text'; text: string }
              | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
            > = [];

            const contentBlocks = m.content as Array<{ type: string; text?: string }>;
            const text = contentBlocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('\n');
            if (text) {
              assistantContent.push({ type: 'text', text });
            }

            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i];
              assistantContent.push({
                type: 'tool_use',
                id: `toolu_${conversationId.slice(0, 8)}_${i}`,
                name: tc.name,
                input: tc.input,
              });
            }

            result.push({ role: 'assistant', content: assistantContent });

            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i];
              result.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool_result',
                    toolUseId: `toolu_${conversationId.slice(0, 8)}_${i}`,
                    content: tc.output,
                  },
                ],
              });
            }
          } else {
            const contentBlocks = m.content as Array<{ type: string; text?: string }>;
            const text = contentBlocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('\n');
            if (text.length > 0) {
              result.push({
                role: 'assistant',
                content: [{ type: 'text', text }],
              });
            }
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to load conversation history: ${error}`);
      return [];
    }
  }

  private hasPII(text: string): boolean {
    if (/[\w.-]+@[\w.-]+\.\w{2,}/i.test(text)) return true;
    if (/\b(?:CC|cc|cédula|cedula|nit|NIT)\s*[:.]?\s*\d{5,12}\b/i.test(text)) return true;
    if (
      /\b(?:carrera|calle|cra|cl|av|avenida|transversal|diagonal|dirección|dir)\b/i.test(text) &&
      /\d{2,}/.test(text)
    )
      return true;
    return false;
  }

  /** Heurística: mensaje que pide cotización/precio → bypassear el cache. */
  private looksLikeQuoteRequest(text: string): boolean {
    return /cotiza|presupuesto|cu[áa]nto (cuesta|cuestan|vale|valen)|precio|precios|tarifa|quote/i.test(
      text,
    );
  }
}
