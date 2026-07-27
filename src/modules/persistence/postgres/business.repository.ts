import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { Business } from '@prisma/client';
import type { Prisma } from '@prisma/client';

@Injectable()
export class BusinessRepository {
  private readonly logger = new Logger(BusinessRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByPhoneId(phoneId: string): Promise<Business | null> {
    return this.prisma.business.findUnique({
      where: { whatsappPhoneId: phoneId },
    });
  }

  async findById(id: string): Promise<Business | null> {
    return this.prisma.business.findUnique({
      where: { id },
    });
  }

  async create(data: {
    name: string;
    whatsappPhoneId: string;
    whatsappTokenEncrypted: string;
    systemPromptExtras?: string;
    settings?: Record<string, unknown>;
  }): Promise<Business> {
    return this.prisma.business.create({
      data: {
        name: data.name,
        whatsappPhoneId: data.whatsappPhoneId,
        whatsappTokenEncrypted: data.whatsappTokenEncrypted,
        systemPromptExtras: data.systemPromptExtras,
        settings: (data.settings ?? {}) as unknown as Prisma.JsonObject,
      },
    });
  }
}
