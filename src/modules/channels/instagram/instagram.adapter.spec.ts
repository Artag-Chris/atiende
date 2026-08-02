import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { InstagramAdapter } from './instagram.adapter';
import type { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import type { ChannelAccountData } from '@core/ports/channel-account-repository.port';

function createAdapter(configOverrides?: Record<string, unknown>) {
  const config = {
    getOrThrow: () => 'app-secret',
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'META_GRAPH_API_VERSION') return 'v21.0';
      if (key === 'META_INSTAGRAM_GRAPH_API_VERSION') return 'v25.0';
      if (configOverrides?.[key] !== undefined) return configOverrides[key];
      return undefined;
    }),
  } as unknown as ConfigService;
  const crypto = {
    decrypt: vi.fn().mockReturnValue('business-ig-token'),
  } as unknown as CryptoService;
  return new InstagramAdapter(config, crypto);
}

describe('InstagramAdapter.parseInboundWebhook', () => {
  it('parses an Instagram DM webhook', () => {
    const adapter = createAdapter();
    const parsed = adapter.parseInboundWebhook({
      object: 'instagram',
      entry: [
        {
          id: '17841400123456789',
          messaging: [
            {
              sender: { id: 'IGSID-12345' },
              recipient: { id: '17841400123456789' },
              timestamp: 1699999999000,
              message: { mid: 'm_ig_1', text: 'Hola' },
            },
          ],
        },
      ],
    });

    expect(parsed[0]).toMatchObject({
      externalAccountId: '17841400123456789',
      from: 'IGSID-12345',
      text: 'Hola',
    });
  });
});

describe('InstagramAdapter.verifyWebhookSignature', () => {
  it('accepts a valid sha256 HMAC with the app secret', () => {
    const adapter = createAdapter();
    const body = '{"object":"instagram"}';
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;

    expect(adapter.verifyWebhookSignature(body, sig)).toBe(true);
  });
});

describe('InstagramAdapter.send', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: 'mid_ig_out', recipient_id: 'IGSID-12345' }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to graph.instagram.com/v25.0/me/messages with the IG access token', async () => {
    const adapter = createAdapter({
      META_DEV_IG_ID: '17841400123456789',
      META_DEV_IG_TOKEN: 'IGAA-dev-ig-token',
    });

    const result = await adapter.send({
      businessId: 'biz-1',
      to: 'IGSID-12345',
      text: 'Hola',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.instagram.com/v25.0/me/messages');
    expect(options.headers.Authorization).toBe('Bearer IGAA-dev-ig-token');
    expect(JSON.parse(options.body)).toEqual({
      recipient: { id: 'IGSID-12345' },
      message: { text: 'Hola' },
    });
    expect(result.externalMessageId).toBe('mid_ig_out');
  });

  it('uses the business account credentials when provided (D1) and does not send messaging_type', async () => {
    const adapter = createAdapter();
    const account: ChannelAccountData = {
      id: 'acc-ig-1',
      businessId: 'biz-1',
      channel: 'instagram',
      accountId: '17841400123456789',
      tokenEncrypted: 'iv:tag:data',
      isPrimary: true,
    };

    await adapter.send({ businessId: 'biz-1', to: 'IGSID-12345', text: 'Hola' }, account);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer business-ig-token');
    expect(JSON.parse(options.body).messaging_type).toBeUndefined();
  });

  it('throws when no account and no dev IG id is configured', async () => {
    const adapter = createAdapter();

    await expect(
      adapter.send({ businessId: 'biz-1', to: 'IGSID-12345', text: 'Hola' }),
    ).rejects.toThrow('META_DEV_IG_ID not configured');
  });

  it('throws with the error status when Meta responds with an error', async () => {
    const adapter = createAdapter({
      META_DEV_IG_ID: '17841400123456789',
      META_DEV_IG_TOKEN: 'token',
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"invalid token"}}',
    });

    await expect(
      adapter.send({ businessId: 'biz-1', to: 'IGSID-12345', text: 'Hola' }),
    ).rejects.toThrow('instagram send failed: 400');
  });
});
