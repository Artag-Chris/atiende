import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { AgentRun } from '@prisma/client';
import type { AgentRunData, AgentRunRepositoryPort } from '@core/ports/agent-run-repository.port';
import type { Prisma } from '@prisma/client';

@Injectable()
export class AgentRunRepository implements AgentRunRepositoryPort {
  private readonly logger = new Logger(AgentRunRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(data: AgentRunData): Promise<void> {
    await this.prisma.agentRun.create({
      data: {
        businessId: data.businessId,
        conversationId: data.conversationId,
        model: data.model,
        llmProvider: data.llmProvider,
        latencyMs: data.latencyMs,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cacheCreationInputTokens: data.cacheCreationInputTokens ?? 0,
        cacheReadInputTokens: data.cacheReadInputTokens ?? 0,
        costUsd: data.costUsd,
        toolCalls: (data.toolCalls ?? []) as unknown as Prisma.JsonArray,
        stopReason: data.stopReason,
      },
    });
  }

  async findByBusiness(
    businessId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<AgentRun[]> {
    return this.prisma.agentRun.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  async getConversationCost(conversationId: string): Promise<number> {
    const result = await this.prisma.agentRun.aggregate({
      where: { conversationId },
      _sum: { costUsd: true },
    });
    return Number(result._sum.costUsd ?? 0);
  }
}
