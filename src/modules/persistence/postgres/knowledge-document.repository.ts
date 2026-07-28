import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { KnowledgeDocument, KnowledgeKind, KnowledgeStatus } from '@prisma/client';

@Injectable()
export class KnowledgeDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<KnowledgeDocument | null> {
    return this.prisma.knowledgeDocument.findUnique({ where: { id } });
  }

  async findByBusiness(businessId: string): Promise<KnowledgeDocument[]> {
    return this.prisma.knowledgeDocument.findMany({
      where: { businessId, active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOrCreate(data: {
    businessId: string;
    kind: string;
    title: string;
    source: string;
    sourceHash: string;
  }): Promise<KnowledgeDocument> {
    return this.prisma.knowledgeDocument.upsert({
      where: {
        businessId_source: { businessId: data.businessId, source: data.source },
      },
      create: {
        businessId: data.businessId,
        kind: data.kind as KnowledgeKind,
        title: data.title,
        source: data.source,
        sourceHash: data.sourceHash,
        status: 'PENDING' as KnowledgeStatus,
      },
      update: {
        sourceHash: data.sourceHash,
        status: 'PENDING' as KnowledgeStatus,
        title: data.title,
        active: true,
        indexedAt: null,
        errorMessage: null,
        chunkCount: 0,
      },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: { chunkCount?: number; errorMessage?: string },
  ): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        status: status as KnowledgeStatus,
        ...(status === 'INDEXED'
          ? { indexedAt: new Date(), chunkCount: extra?.chunkCount ?? 0 }
          : {}),
        ...(status === 'FAILED'
          ? { errorMessage: extra?.errorMessage, indexedAt: null, chunkCount: 0 }
          : {}),
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { active: false },
    });
  }
}
