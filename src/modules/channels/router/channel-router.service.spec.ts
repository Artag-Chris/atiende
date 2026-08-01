import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelRouterService, ChannelProviderNotFoundError } from './channel-router.service';
import type { ChannelProviderPort, OutboundMessage } from '@core/ports/channel-provider.port';
import type { ChannelAccountRepositoryPort } from '@core/ports/channel-account-repository.port';
import type { ChannelAccountData } from '@core/ports/channel-account-repository.port';

function makeProvider(channel: ChannelProviderPort['name']) {
  return {
    name: channel,
    send: vi.fn().mockResolvedValue({ externalMessageId: 'mid-1', sentAt: new Date() }),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    parseInboundWebhook: vi.fn().mockReturnValue([]),
    isHealthy: vi.fn().mockResolvedValue(true),
  } as unknown as ChannelProviderPort;
}

function makeAccountRepo(): ChannelAccountRepositoryPort {
  return {
    findForBusiness: vi.fn().mockResolvedValue(null),
  };
}

const message: OutboundMessage = {
  businessId: 'biz-1',
  to: '573001234567',
  text: 'Hola',
};

describe('ChannelRouterService', () => {
  let whatsapp: ReturnType<typeof makeProvider>;

  beforeEach(() => {
    whatsapp = makeProvider('whatsapp');
  });

  it('routes send() to the provider whose name matches the channel', async () => {
    const router = new ChannelRouterService(
      [whatsapp] as unknown as ChannelProviderPort[],
      makeAccountRepo(),
    );

    await router.send('whatsapp', message);

    expect(whatsapp.send).toHaveBeenCalledWith(message, undefined);
  });

  it('resolves the business account and passes it to the provider (D1)', async () => {
    const account: ChannelAccountData = {
      id: 'acc-1',
      businessId: 'biz-1',
      channel: 'whatsapp',
      accountId: 'phone-id-2',
      tokenEncrypted: 'iv:tag:data',
      isPrimary: true,
    };
    const accountRepo = makeAccountRepo();
    accountRepo.findForBusiness = vi.fn().mockResolvedValue(account);
    const router = new ChannelRouterService(
      [whatsapp] as unknown as ChannelProviderPort[],
      accountRepo,
    );

    await router.send('whatsapp', message);

    expect(accountRepo.findForBusiness).toHaveBeenCalledWith('whatsapp', 'biz-1');
    expect(whatsapp.send).toHaveBeenCalledWith(message, account);
  });

  it('throws ChannelProviderNotFoundError for channels without a registered provider', async () => {
    const router = new ChannelRouterService(
      [whatsapp] as unknown as ChannelProviderPort[],
      makeAccountRepo(),
    );

    expect(() => router.getProvider('instagram')).toThrow(ChannelProviderNotFoundError);
  });

  it('works with an empty provider list', () => {
    const router = new ChannelRouterService([], makeAccountRepo());

    expect(router.channels()).toEqual([]);
    expect(() => router.getProvider('whatsapp')).toThrow(ChannelProviderNotFoundError);
  });

  it('lists the registered channels', () => {
    const router = new ChannelRouterService(
      [whatsapp, makeProvider('messenger')] as unknown as ChannelProviderPort[],
      makeAccountRepo(),
    );

    expect(router.channels().sort()).toEqual(['messenger', 'whatsapp']);
  });
});
