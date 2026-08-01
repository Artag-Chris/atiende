import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelRouterService, ChannelProviderNotFoundError } from './channel-router.service';
import type { ChannelProviderPort, OutboundMessage } from '@core/ports/channel-provider.port';

function makeProvider(channel: ChannelProviderPort['name']) {
  return {
    name: channel,
    send: vi.fn().mockResolvedValue({ externalMessageId: 'mid-1', sentAt: new Date() }),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    parseInboundWebhook: vi.fn().mockReturnValue([]),
    isHealthy: vi.fn().mockResolvedValue(true),
  } as unknown as ChannelProviderPort;
}

describe('ChannelRouterService', () => {
  let whatsapp: ReturnType<typeof makeProvider>;

  beforeEach(() => {
    whatsapp = makeProvider('whatsapp');
  });

  it('routes send() to the provider whose name matches the channel', async () => {
    const router = new ChannelRouterService([whatsapp] as unknown as ChannelProviderPort[]);
    const message: OutboundMessage = {
      businessId: 'biz-1',
      to: '573001234567',
      text: 'Hola',
    };

    await router.send('whatsapp', message);

    expect(whatsapp.send).toHaveBeenCalledWith(message);
  });

  it('throws ChannelProviderNotFoundError for channels without a registered provider', async () => {
    const router = new ChannelRouterService([whatsapp] as unknown as ChannelProviderPort[]);

    expect(() => router.getProvider('instagram')).toThrow(ChannelProviderNotFoundError);
  });

  it('works with an empty provider list', () => {
    const router = new ChannelRouterService([]);

    expect(router.channels()).toEqual([]);
    expect(() => router.getProvider('whatsapp')).toThrow(ChannelProviderNotFoundError);
  });

  it('lists the registered channels', () => {
    const router = new ChannelRouterService([
      whatsapp,
      makeProvider('messenger'),
    ] as unknown as ChannelProviderPort[]);

    expect(router.channels().sort()).toEqual(['messenger', 'whatsapp']);
  });
});
