import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessInboundMessageUseCase } from './process-inbound-message';
import { AgentService } from '@core/services/agent.service';
import type { AgentRunRepositoryPort } from '@core/ports/agent-run-repository.port';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { ResponsePolicyPort } from '@core/ports/response-policy.port';
import type { ResponseCachePort } from '@core/ports/response-cache.port';
import type { UnitOfWorkPort } from '@core/ports/unit-of-work.port';

const baseMessage = {
  channel: 'whatsapp' as const,
  externalAccountId: 'phone-id-1',
  from: '573001234567',
  text: 'Hola, ¿tienen horario de atención?',
  externalMessageId: 'msg-1',
  rawPayload: { entry: [] },
};

function createAgentService() {
  return {
    runTurn: vi.fn().mockResolvedValue({
      text: 'Respuesta del agente',
      model: 'mock',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.0001,
      latencyMs: 100,
      toolCallsMade: [],
    }),
  } as unknown as AgentService;
}

function createAgentRunRepo() {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getConversationCost: vi.fn().mockResolvedValue(0),
  } as unknown as AgentRunRepositoryPort;
}

function createBusinessRepo() {
  return {
    findByChannelAccount: vi.fn().mockResolvedValue({
      id: 'biz-1',
      name: 'Test Business',
      whatsappPhoneId: 'phone-id-1',
      settings: {},
    }),
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as BusinessRepositoryPort;
}

function createConversationRepo() {
  return {
    getOrCreate: vi.fn().mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'WHATSAPP',
      customerIdentifier: '573001234567',
      status: 'ACTIVE',
    }),
    findById: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    findEscalated: vi.fn().mockResolvedValue([]),
    incrementUnread: vi.fn().mockResolvedValue(undefined),
    resetUnread: vi.fn().mockResolvedValue(undefined),
    findPending: vi.fn().mockResolvedValue([]),
  } as unknown as ConversationRepositoryPort;
}

function createMessageRepo() {
  return {
    save: vi.fn().mockImplementation((data) =>
      Promise.resolve({
        id: 'msg-x',
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        createdAt: new Date(),
        created: true,
      }),
    ),
    findRecent: vi.fn().mockResolvedValue([]),
    findInboundActivity: vi.fn().mockResolvedValue([]),
  } as unknown as MessageRepositoryPort;
}

function createInboundRepo() {
  return {
    save: vi.fn().mockResolvedValue({
      id: 'inb-1',
      businessId: 'biz-1',
      externalMessageId: 'msg-1',
      receivedAt: new Date(),
      processedAt: null,
    }),
    findByExternalId: vi.fn().mockResolvedValue(null),
    markProcessed: vi.fn().mockResolvedValue(undefined),
  } as unknown as InboundMessageRepositoryPort;
}

function createResponsePolicy() {
  return {
    checkScope: vi.fn().mockResolvedValue({ allowed: true }),
    buildSystemPromptExtras: vi.fn().mockReturnValue(''),
    validateResponse: vi.fn().mockReturnValue({ approved: true }),
  } as unknown as ResponsePolicyPort;
}

function createCache(name: string) {
  return {
    name,
    lookup: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(0),
  } as unknown as ResponseCachePort;
}

function createUnitOfWork(repos: {
  conversationRepo: ReturnType<typeof createConversationRepo>;
  inboundMessageRepo: ReturnType<typeof createInboundRepo>;
  messageRepo: ReturnType<typeof createMessageRepo>;
}) {
  return {
    withTransaction: vi.fn(async <T>(fn: (ctx: unknown) => Promise<T>) => fn(repos)),
  } as unknown as UnitOfWorkPort;
}

interface Ctx {
  agent: ReturnType<typeof createAgentService>;
  businessRepo: ReturnType<typeof createBusinessRepo>;
  conversationRepo: ReturnType<typeof createConversationRepo>;
  messageRepo: ReturnType<typeof createMessageRepo>;
  inboundRepo: ReturnType<typeof createInboundRepo>;
  responsePolicy: ReturnType<typeof createResponsePolicy>;
  exactCache: ReturnType<typeof createCache>;
  semanticCache: ReturnType<typeof createCache>;
  unitOfWork: UnitOfWorkPort;
  useCase: ProcessInboundMessageUseCase;
}

function buildUseCase(overrides?: { responsePolicy?: boolean; caches?: boolean }): Ctx {
  const agent = createAgentService();
  const agentRunRepo = createAgentRunRepo();
  const businessRepo = createBusinessRepo();
  const conversationRepo = createConversationRepo();
  const messageRepo = createMessageRepo();
  const inboundRepo = createInboundRepo();
  const responsePolicy = createResponsePolicy();
  const exactCache = createCache('exact');
  const semanticCache = createCache('semantic');
  const unitOfWork = createUnitOfWork({
    conversationRepo,
    inboundMessageRepo: inboundRepo,
    messageRepo,
  });

  const useCase = new ProcessInboundMessageUseCase(
    agent,
    agentRunRepo,
    businessRepo,
    conversationRepo,
    messageRepo,
    inboundRepo,
    unitOfWork,
    (overrides?.responsePolicy ?? true) ? responsePolicy : undefined,
    (overrides?.caches ?? true) ? exactCache : undefined,
    (overrides?.caches ?? true) ? semanticCache : undefined,
  );

  return {
    agent,
    businessRepo,
    conversationRepo,
    messageRepo,
    inboundRepo,
    responsePolicy,
    exactCache,
    semanticCache,
    unitOfWork,
    useCase,
  };
}

describe('ProcessInboundMessageUseCase', () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildUseCase();
  });

  it('processes without persistence when business not found', async () => {
    ctx.businessRepo.findByChannelAccount = vi.fn().mockResolvedValue(null);

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(result.responseText).toBe('Respuesta del agente');
    expect(ctx.agent.runTurn).toHaveBeenCalledTimes(1);
    expect(ctx.messageRepo.save).not.toHaveBeenCalled();
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
  });

  it('blocks out-of-scope messages without calling agent', async () => {
    ctx.responsePolicy.checkScope = vi
      .fn()
      .mockResolvedValue({ allowed: false, rejectionMessage: 'Fuera de alcance' });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(result.responseText).toBe('Fuera de alcance');
    expect(ctx.agent.runTurn).not.toHaveBeenCalled();
    expect(ctx.conversationRepo.getOrCreate).not.toHaveBeenCalled();
  });

  it('returns the persisted inbound id for blocked messages so they can be marked processed', async () => {
    ctx.inboundRepo.findByExternalId = vi.fn().mockResolvedValue({
      id: 'inb-1',
      businessId: 'biz-1',
      externalMessageId: 'msg-1',
      receivedAt: new Date(),
      processedAt: null,
    });
    ctx.responsePolicy.checkScope = vi
      .fn()
      .mockResolvedValue({ allowed: false, rejectionMessage: 'Fuera de alcance' });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.inboundMessageId).toBe('inb-1');
    expect(ctx.inboundRepo.findByExternalId).toHaveBeenCalledWith('biz-1', 'msg-1');
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
  });

  it('persists the inbound row when a blocked message has none yet', async () => {
    ctx.responsePolicy.checkScope = vi
      .fn()
      .mockResolvedValue({ allowed: false, rejectionMessage: 'Fuera de alcance' });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.inboundMessageId).toBe('inb-1');
    expect(ctx.inboundRepo.findByExternalId).toHaveBeenCalledWith('biz-1', 'msg-1');
    expect(ctx.inboundRepo.save).toHaveBeenCalledWith({
      businessId: 'biz-1',
      rawPayload: baseMessage.rawPayload,
      externalMessageId: 'msg-1',
    });
  });

  it('skips already-processed messages', async () => {
    ctx.inboundRepo.findByExternalId = vi.fn().mockResolvedValue({
      id: 'inb-1',
      businessId: 'biz-1',
      externalMessageId: 'msg-1',
      receivedAt: new Date(),
      processedAt: new Date(),
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(false);
    expect(ctx.agent.runTurn).not.toHaveBeenCalled();
    expect(ctx.messageRepo.save).not.toHaveBeenCalled();
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
  });

  it('re-processes a message whose previous attempt failed mid-flight', async () => {
    ctx.inboundRepo.findByExternalId = vi.fn().mockResolvedValue({
      id: 'inb-1',
      businessId: 'biz-1',
      externalMessageId: 'msg-1',
      receivedAt: new Date(),
      processedAt: null,
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(result.responseText).toBe('Respuesta del agente');
    expect(ctx.agent.runTurn).toHaveBeenCalledTimes(1);
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
    expect(ctx.messageRepo.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'USER', inboundMessageId: 'inb-1' }),
    );
  });

  it('reuses an inbound row already persisted by the webhook', async () => {
    ctx.inboundRepo.findByExternalId = vi.fn().mockResolvedValue({
      id: 'inb-web',
      businessId: 'biz-1',
      externalMessageId: 'msg-1',
      receivedAt: new Date(),
      processedAt: null,
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.inboundMessageId).toBe('inb-web');
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
    expect(ctx.messageRepo.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'USER', inboundMessageId: 'inb-web' }),
    );
  });

  it('returns cached response without calling agent', async () => {
    ctx.exactCache.lookup = vi.fn().mockResolvedValue({
      responseText: 'Respuesta cacheada',
      similarity: 1,
      cachedAt: new Date(),
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(result.responseText).toBe('Respuesta cacheada');
    expect(result.inboundMessageId).toBe('inb-1');
    expect(ctx.agent.runTurn).not.toHaveBeenCalled();
    expect(ctx.messageRepo.save).toHaveBeenCalledTimes(1);
    expect(ctx.inboundRepo.markProcessed).not.toHaveBeenCalled();
  });

  it('modifies cached response when validation fails', async () => {
    ctx.exactCache.lookup = vi.fn().mockResolvedValue({
      responseText: 'Respuesta cacheada',
      similarity: 1,
      cachedAt: new Date(),
    });
    ctx.responsePolicy.validateResponse = vi.fn().mockReturnValue({
      approved: false,
      modified: 'Respuesta corregida',
      reason: 'hallucination',
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responseText).toBe('Respuesta corregida');
    expect(ctx.agent.runTurn).not.toHaveBeenCalled();
  });

  it('degrades gracefully when cache lookup fails', async () => {
    ctx.exactCache.lookup = vi.fn().mockRejectedValue(new Error('redis down'));
    ctx.semanticCache.lookup = vi.fn().mockRejectedValue(new Error('pg down'));

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(result.responseText).toBe('Respuesta del agente');
    expect(ctx.agent.runTurn).toHaveBeenCalledTimes(1);
  });

  it('persists user and assistant messages on normal flow', async () => {
    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(result.inboundMessageId).toBe('inb-1');
    expect(ctx.agent.runTurn).toHaveBeenCalledTimes(1);
    expect(ctx.unitOfWork.withTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.messageRepo.save).toHaveBeenCalledTimes(2);
    expect(ctx.messageRepo.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: 'USER',
        conversationId: 'conv-1',
        inboundMessageId: 'inb-1',
      }),
    );
    expect(ctx.messageRepo.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'ASSISTANT', conversationId: 'conv-1' }),
    );
    expect(ctx.inboundRepo.markProcessed).not.toHaveBeenCalled();
    expect(ctx.exactCache.store).toHaveBeenCalledTimes(1);
    expect(ctx.semanticCache.store).toHaveBeenCalledTimes(1);
  });

  it('persists inbound, conversation and user message inside a single transaction', async () => {
    await ctx.useCase.execute(baseMessage);

    const txFn = vi.mocked(ctx.unitOfWork.withTransaction).mock.calls[0][0];
    expect(ctx.unitOfWork.withTransaction).toHaveBeenCalledTimes(1);
    expect(typeof txFn).toBe('function');
    expect(ctx.conversationRepo.getOrCreate).toHaveBeenCalledWith(
      'biz-1',
      'whatsapp',
      '573001234567',
      undefined,
    );
    expect(ctx.inboundRepo.findByExternalId).toHaveBeenCalledWith('biz-1', 'msg-1');
    expect(ctx.inboundRepo.save).toHaveBeenCalledTimes(1);
    expect(ctx.conversationRepo.incrementUnread).toHaveBeenCalledWith('conv-1');
  });

  it('does not re-increment unread when the USER message already exists (job retry)', async () => {
    ctx.messageRepo.save = vi.fn().mockResolvedValue({
      id: 'msg-x',
      conversationId: 'conv-1',
      role: 'USER',
      content: [{ type: 'text', text: 'Hola' }],
      createdAt: new Date(),
      created: false,
    });

    await ctx.useCase.execute(baseMessage);

    expect(ctx.conversationRepo.incrementUnread).not.toHaveBeenCalled();
  });

  it('reopens a RESOLVED conversation on a new inbound message', async () => {
    ctx.conversationRepo.getOrCreate = vi.fn().mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'WHATSAPP',
      customerIdentifier: '573001234567',
      status: 'RESOLVED',
    });

    await ctx.useCase.execute(baseMessage);

    expect(ctx.conversationRepo.updateStatus).toHaveBeenCalledWith('conv-1', 'ACTIVE');
  });

  it('resets unread after the assistant replies', async () => {
    await ctx.useCase.execute(baseMessage);

    expect(ctx.conversationRepo.resetUnread).toHaveBeenCalledWith('conv-1');
  });

  it('resets unread on cached responses', async () => {
    ctx.exactCache.lookup = vi.fn().mockResolvedValue({
      responseText: 'Respuesta cacheada',
      similarity: 1,
      cachedAt: new Date(),
    });

    await ctx.useCase.execute(baseMessage);

    expect(ctx.conversationRepo.resetUnread).toHaveBeenCalledWith('conv-1');
  });

  it('returns early when the business is missing (no transaction, no persistence)', async () => {
    ctx.businessRepo.findByChannelAccount = vi.fn().mockResolvedValue(null);

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(ctx.unitOfWork.withTransaction).not.toHaveBeenCalled();
    expect(ctx.conversationRepo.getOrCreate).not.toHaveBeenCalled();
    expect(ctx.messageRepo.save).not.toHaveBeenCalled();
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
  });

  it('escalates conversation when escalate_to_human tool called', async () => {
    ctx.agent.runTurn = vi.fn().mockResolvedValue({
      text: 'Te conecto con un asesor',
      model: 'mock',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.0001,
      latencyMs: 100,
      toolCallsMade: [
        {
          name: 'escalate_to_human',
          input: { reason: 'Cliente enojado', urgency: 'high' },
          output: 'escalated',
        },
      ],
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(ctx.conversationRepo.updateStatus).toHaveBeenCalledWith(
      'conv-1',
      'ESCALATED',
      expect.objectContaining({
        escalationReason: 'Cliente enojado',
        urgency: 'HIGH',
      }),
    );
  });

  it('returns modified response when validation fails on agent output', async () => {
    ctx.responsePolicy.validateResponse = vi.fn().mockReturnValue({
      approved: false,
      modified: 'Respuesta revisada',
      reason: 'policy violation',
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responseText).toBe('Respuesta revisada');
  });

  it('markProcessed swallows repository failures', async () => {
    ctx.inboundRepo.markProcessed = vi.fn().mockRejectedValue(new Error('db error'));

    await expect(ctx.useCase.markProcessed('inb-1')).resolves.toBeUndefined();
  });

  it('markProcessed delegates to the repository on success', async () => {
    await ctx.useCase.markProcessed('inb-1');

    expect(ctx.inboundRepo.markProcessed).toHaveBeenCalledWith('inb-1');
  });

  it('survives escalation status update failure', async () => {
    ctx.agent.runTurn = vi.fn().mockResolvedValue({
      text: 'Te conecto con un asesor',
      model: 'mock',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.0001,
      latencyMs: 100,
      toolCallsMade: [
        {
          name: 'escalate_to_human',
          input: { reason: 'test', urgency: 'medium' },
          output: 'escalated',
        },
      ],
    });
    ctx.conversationRepo.updateStatus = vi.fn().mockRejectedValue(new Error('db error'));

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(ctx.messageRepo.save).toHaveBeenCalledTimes(2);
  });

  it('allows message through when scope check fails', async () => {
    ctx.responsePolicy.checkScope = vi.fn().mockRejectedValue(new Error('policy service down'));

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(true);
    expect(ctx.agent.runTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps the AI silent when the conversation is escalated', async () => {
    ctx.conversationRepo.getOrCreate = vi.fn().mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'WHATSAPP',
      customerIdentifier: '573001234567',
      status: 'ESCALATED',
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(false);
    expect(result.skipReason).toBe('escalated');
    expect(result.inboundMessageId).toBe('inb-1');
    expect(ctx.agent.runTurn).not.toHaveBeenCalled();
    expect(ctx.exactCache.store).not.toHaveBeenCalled();
    expect(ctx.semanticCache.store).not.toHaveBeenCalled();
    // El USER entrante sí se persiste para que el humano tenga contexto.
    expect(ctx.messageRepo.save).toHaveBeenCalledTimes(1);
    expect(ctx.messageRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'USER', inboundMessageId: 'inb-1' }),
    );
  });

  it('returns the inbound id for escalated messages so they can be marked processed', async () => {
    ctx.conversationRepo.getOrCreate = vi.fn().mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'WHATSAPP',
      customerIdentifier: '573001234567',
      status: 'ESCALATED',
    });
    ctx.inboundRepo.findByExternalId = vi.fn().mockResolvedValue({
      id: 'inb-web',
      businessId: 'biz-1',
      externalMessageId: 'msg-1',
      receivedAt: new Date(),
      processedAt: null,
    });

    const result = await ctx.useCase.execute(baseMessage);

    expect(result.responded).toBe(false);
    expect(result.inboundMessageId).toBe('inb-web');
    expect(ctx.inboundRepo.save).not.toHaveBeenCalled();
  });
});
