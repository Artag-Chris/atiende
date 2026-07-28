import { describe, it, expect, beforeEach } from 'vitest';
import { EscalateToHumanTool } from './escalate-to-human.tool';

describe('EscalateToHumanTool', () => {
  let tool: EscalateToHumanTool;
  const ctx = {
    businessId: 'biz-1',
    conversationId: 'conv-1',
    customerPhone: '+573001234567',
    channel: 'whatsapp' as const,
    historyLength: 0,
    hasPersonalInfo: false,
    mayInvolveStatefulTool: true,
    businessConfig: {},
  };

  beforeEach(() => {
    tool = new EscalateToHumanTool();
  });

  it('has correct metadata', () => {
    expect(tool.name).toBe('escalate_to_human');
    expect(tool.mutatesState).toBe(true);
  });

  it('returns valid ToolDefinition', () => {
    const def = tool.getDefinition();
    expect(def.name).toBe('escalate_to_human');
    expect(def.description).toBeTruthy();
    expect(def.inputSchema.properties).toHaveProperty('reason');
    expect(def.inputSchema.properties).toHaveProperty('urgency');
  });

  it('escalates with default urgency', async () => {
    const result = await tool.execute({ reason: 'Cliente enojado' }, ctx);

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.status).toBe('escalated');
    expect(parsed.urgency).toBe('medium');
    expect(parsed.reason).toBe('Cliente enojado');
  });

  it('escalates with custom urgency', async () => {
    const result = await tool.execute(
      { reason: 'Fraude detectado', urgency: 'high' },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.urgency).toBe('high');
  });

  it('rejects empty reason', async () => {
    const result = await tool.execute({ reason: '' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('rejects invalid urgency', async () => {
    const result = await tool.execute(
      { reason: 'Test', urgency: 'critical' },
      ctx,
    );
    expect(result.isError).toBe(true);
  });

  it('rejects missing reason', async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  it('sets meta.latencyMs', async () => {
    const result = await tool.execute({ reason: 'Test' }, ctx);
    expect(result.meta?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
