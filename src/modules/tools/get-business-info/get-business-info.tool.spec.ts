import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetBusinessInfoTool } from './get-business-info.tool';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';

const mockBusiness: ReturnType<BusinessRepositoryPort['findById']> = Promise.resolve({
  id: 'biz-1',
  name: 'LumenX Labs',
  whatsappPhoneId: '1161637943695191',
  settings: {
    website: 'https://lumenx.dev',
    business_hours: 'Lun-Vie 9:00-18:00',
    location: 'Bogotá, Colombia',
    language: 'es',
  },
});

function createTool(businessRepo?: Partial<BusinessRepositoryPort>): GetBusinessInfoTool {
  return new GetBusinessInfoTool({
    findByPhoneId: vi.fn(),
    findById: businessRepo?.findById ?? (() => mockBusiness),
    ...businessRepo,
  } as BusinessRepositoryPort);
}

describe('GetBusinessInfoTool', () => {
  let tool: GetBusinessInfoTool;

  beforeEach(() => {
    tool = createTool();
  });

  it('has correct metadata', () => {
    expect(tool.name).toBe('get_business_info');
    expect(tool.mutatesState).toBe(false);
  });

  it('returns valid ToolDefinition', () => {
    const def = tool.getDefinition();
    expect(def.name).toBe('get_business_info');
    expect(def.description).toBeTruthy();
    expect(def.inputSchema.properties).toHaveProperty('topic');
  });

  it('returns full info for topic=general', async () => {
    const result = await tool.execute(
      { topic: 'general' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        customerPhone: '+573001234567',
        channel: 'whatsapp',
        historyLength: 0,
        hasPersonalInfo: false,
        mayInvolveStatefulTool: false,
        businessConfig: {},
      },
    );

    expect(result.isError).toBeFalsy();
    const info = JSON.parse(result.output);
    expect(info.name).toBe('LumenX Labs');
    expect(info.website).toBe('https://lumenx.dev');
  });

  it('filters by topic', async () => {
    const result = await tool.execute(
      { topic: 'website' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        customerPhone: '+573001234567',
        channel: 'whatsapp',
        historyLength: 0,
        hasPersonalInfo: false,
        mayInvolveStatefulTool: false,
        businessConfig: {},
      },
    );

    expect(result.isError).toBeFalsy();
    const info = JSON.parse(result.output);
    expect(info.website).toBe('https://lumenx.dev');
    expect(info.name).toBeUndefined();
  });

  it('returns error for invalid input', async () => {
    const result = await tool.execute(
      { topic: '' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        customerPhone: '+573001234567',
        channel: 'whatsapp',
        historyLength: 0,
        hasPersonalInfo: false,
        mayInvolveStatefulTool: false,
        businessConfig: {},
      },
    );

    expect(result.isError).toBe(true);
  });

  it('returns error when business not found', async () => {
    const toolNotFound = createTool({
      findById: () => Promise.resolve(null),
    });

    const result = await toolNotFound.execute(
      { topic: 'general' },
      {
        businessId: 'nonexistent',
        conversationId: 'conv-1',
        customerPhone: '+573001234567',
        channel: 'whatsapp',
        historyLength: 0,
        hasPersonalInfo: false,
        mayInvolveStatefulTool: false,
        businessConfig: {},
      },
    );

    expect(result.isError).toBe(true);
  });

  it('returns friendly message for unmatched topic', async () => {
    const result = await tool.execute(
      { topic: 'precios' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        customerPhone: '+573001234567',
        channel: 'whatsapp',
        historyLength: 0,
        hasPersonalInfo: false,
        mayInvolveStatefulTool: false,
        businessConfig: {},
      },
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('precios');
  });
});
