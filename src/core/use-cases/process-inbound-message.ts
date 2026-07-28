import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { AgentService } from '@core/services/agent.service';
import type { AgentRunRepositoryPort } from '@core/ports/agent-run-repository.port';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { ChatMessage } from '@core/domain/types';
import type { ResponsePolicyPort } from '@core/ports/response-policy.port';
import {
  AGENT_RUN_REPOSITORY_TOKEN,
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  BUSINESS_REPOSITORY_TOKEN,
  RESPONSE_POLICY_TOKEN,
} from '@core/tokens';

const DEFAULT_SYSTEM_PROMPT = `Eres un asistente conversacional de IA. Atiendes clientes por WhatsApp con calidez y eficiencia.

HERRAMIENTAS DISPONIBLES:
- get_business_info: usa esta tool cuando el cliente pregunte por horarios, ubicación, servicios o información general del negocio.
- search_catalog: usa esta tool cuando el cliente busque productos, pregunte por precios, o quiera recomendaciones. Busca semánticamente en el catálogo.
- get_product: usa esta tool cuando necesites ver el detalle completo de un producto específico que ya encontraste.
- create_order: usa esta tool cuando el cliente quiera comprar algo o hacer un pedido. Confirma stock antes de crear.
- search_knowledge: usa esta tool cuando el cliente pregunte por políticas de devolución, garantías, métodos de pago, horarios, envíos, o cualquier información que no esté en el catálogo de productos. Busca en documentos de conocimiento (FAQs, políticas, manuales).
- escalate_to_human: usa esta tool cuando el cliente pida hablar con una persona real, tenga una queja, o necesite soporte especializado.

REGLAS:
- Responde en el idioma del cliente (español o inglés).
- Usa las herramientas cuando sea apropiado antes de responder.
- Nunca inventes precios, productos o servicios que no estén en las herramientas.
- Si el cliente solicita algo fuera de tu alcance, escala a un humano.`;

export interface InboundMessage {
  externalAccountId: string;
  from: string;
  text: string;
  externalMessageId: string;
  rawPayload: Record<string, unknown>;
}

export interface ProcessResult {
  responded: boolean;
  responseText?: string;
  error?: string;
}

@Injectable()
export class ProcessInboundMessageUseCase {
  private readonly logger = new Logger(ProcessInboundMessageUseCase.name);

  constructor(
    private readonly agentService: AgentService,
    @Inject(AGENT_RUN_REPOSITORY_TOKEN) private readonly agentRunRepo: AgentRunRepositoryPort,
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
    @Inject(CONVERSATION_REPOSITORY_TOKEN) private readonly conversationRepo: ConversationRepositoryPort,
    @Inject(MESSAGE_REPOSITORY_TOKEN) private readonly messageRepo: MessageRepositoryPort,
    @Inject(INBOUND_MESSAGE_REPOSITORY_TOKEN) private readonly inboundMessageRepo: InboundMessageRepositoryPort,
    @Optional() @Inject(RESPONSE_POLICY_TOKEN) private readonly responsePolicy?: ResponsePolicyPort,
  ) {}

  async execute(message: InboundMessage): Promise<ProcessResult> {
    this.logger.log(`Processing message from ${message.from}: "${message.text}"`);

    const business = await this.businessRepo.findByPhoneId(message.externalAccountId);
    if (!business) {
      this.logger.warn(
        `No business found for phone_id=${message.externalAccountId}. Processing without persistence.`,
      );
    }

    if (business && this.responsePolicy) {
      try {
        const scope = await this.responsePolicy.checkScope(business.id, message.text, business.name ?? undefined);
        if (!scope.allowed) {
          this.logger.log(`Out-of-scope message blocked: "${message.text.slice(0, 60)}..."`);
          return { responded: true, responseText: scope.rejectionMessage };
        }
      } catch (error) {
        this.logger.warn(`Scope check failed (allowing message through): ${error}`);
      }
    }

    const conversation = business
      ? await this.conversationRepo.getOrCreate(business.id, 'WHATSAPP', message.from)
      : null;

    if (business && conversation) {
      const alreadyExists = await this.inboundMessageRepo.existsByExternalId(
        business.id,
        message.externalMessageId,
      );
      if (alreadyExists) {
        this.logger.debug(`Duplicate inbound message ${message.externalMessageId}, skipping`);
        return { responded: false };
      }

      await this.inboundMessageRepo.save({
        businessId: business.id,
        rawPayload: message.rawPayload,
        externalMessageId: message.externalMessageId,
      });
    }

    const conversationHistory = conversation
      ? await this.loadConversationHistory(conversation.id)
      : undefined;

    if (business && conversation) {
      await this.messageRepo.save({
        conversationId: conversation.id,
        role: 'USER',
        content: [{ type: 'text', text: message.text }],
      });
    }

    const systemPrompt = this.buildSystemPrompt(
      business?.systemPromptExtras,
      business?.name ?? undefined,
    );

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
        channel: 'whatsapp',
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
    }

    this.logger.log(
      `Agent responded: "${finalText.slice(0, 100)}..." (${agentResponse.latencyMs}ms, $${agentResponse.costUsd.toFixed(6)})`,
    );

    return { responded: true, responseText: finalText };
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
        } else if (m.role === 'ASSISTANT') {
          const tokenUsage = m.tokenUsage as Record<string, unknown> | undefined;
          const toolCalls = (tokenUsage?.toolCalls as Array<{
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
}
