import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { PostgresPersistenceModule } from './postgres-persistence.module';
import { PrismaService } from './prisma.service';
import { PostgresUnitOfWork } from './unit-of-work';
import {
  AGENT_RUN_REPOSITORY_TOKEN,
  BUSINESS_REPOSITORY_TOKEN,
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  UNIT_OF_WORK_TOKEN,
  GROWTH_ANALYTICS_REPOSITORY_TOKEN,
  GROWTH_USAGE_REPOSITORY_TOKEN,
} from '@core/tokens';

describe('PostgresPersistenceModule (DI wiring)', () => {
  it('boots and resolves every provider without DI metadata errors', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PostgresPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    await expect(moduleRef.init()).resolves.toBeDefined();

    expect(moduleRef.get(AGENT_RUN_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(BUSINESS_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(CONVERSATION_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(MESSAGE_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(INBOUND_MESSAGE_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(GROWTH_ANALYTICS_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(GROWTH_USAGE_REPOSITORY_TOKEN)).toBeDefined();
    expect(moduleRef.get(UNIT_OF_WORK_TOKEN)).toBeInstanceOf(PostgresUnitOfWork);
  });
});
