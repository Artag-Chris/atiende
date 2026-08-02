import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MessengerAdapter } from './messenger.adapter';
import type { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import type { ChannelAccountData } from '@core/ports/channel-account-repository.port';

function createAdapter(configOverrides?: Record<string, unknown>) {
  const config = {
    getOrThrow: () => 'app-secret',
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'META_GRAPH_API_VERSION') return 'v21.0';
      if (configOverrides?.[key] !== undefined) return configOverrides[key];
      return undefined;
    }),
  } as unknown as ConfigService;
  const crypto = {
    decrypt: vi.fn().mockReturnValue('business-page-token'),
  } as unknown as CryptoService;
  return new MessengerAdapter(config, crypto);
}

describe('MessengerAdapter.parseInboundWebhook', () => {
  it('parses a Messenger page webhook', () => {
    const adapter = createAdapter();
    const parsed = adapter.parseInboundWebhook({
      object: 'page',
      entry: [
        {
          id: '10987654321',
          messaging: [
            {
              sender: { id: 'PSID-98765' },
              recipient: { id: '10987654321' },
              timestamp: 1700000000000,
              message: { mid: 'm_page_1', text: 'Buenos días' },
            },
          ],
        },
      ],
    });

    expect(parsed[0]).toMatchObject({
      externalAccountId: '10987654321',
      from: 'PSID-98765',
      text: 'Buenos días',
    });
  });
});

describe('MessengerAdapter.send', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: 'mid_page_out', recipient_id: 'PSID-98765' }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to graph.facebook.com/{v}/{PAGE_ID}/messages with messaging_type RESPONSE', async () => {
    const adapter = createAdapter({
      META_DEV_PAGE_ID: '10987654321',
      META_MESSENGER_PAGE_TOKEN: 'EAAG-dev-page-token',
    });

    const result = await adapter.send({
      businessId: 'biz-1',
      to: 'PSID-98765',
      text: 'Hola',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/10987654321/messages');
    expect(options.headers.Authorization).toBe('Bearer EAAG-dev-page-token');
    expect(JSON.parse(options.body)).toEqual({
      recipient: { id: 'PSID-98765' },
      message: { text: 'Hola' },
      messaging_type: 'RESPONSE',
    });
    expect(result.externalMessageId).toBe('mid_page_out');
  });

  it('uses the business account credentials when provided (D1)', async () => {
    const adapter = createAdapter();
    const account: ChannelAccountData = {
      id: 'acc-page-1',
      businessId: 'biz-1',
      channel: 'messenger',
      accountId: '10987654321',
      tokenEncrypted: 'iv:tag:data',
      isPrimary: true,
    };

    await adapter.send({ businessId: 'biz-1', to: 'PSID-98765', text: 'Hola' }, account);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer business-page-token');
  });

  it('throws when no account and no dev page id is configured', async () => {
    const adapter = createAdapter();

    await expect(
      adapter.send({ businessId: 'biz-1', to: 'PSID-98765', text: 'Hola' }),
    ).rejects.toThrow('META_DEV_PAGE_ID not configured');
  });
});
