import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
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
    decrypt: vi.fn().mockReturnValue('business-token'),
  } as unknown as CryptoService;
  return new WhatsAppAdapter(config, crypto);
}

describe('WhatsAppAdapter.parseInboundWebhook', () => {
  let adapter: WhatsAppAdapter;

  beforeEach(() => {
    adapter = createAdapter();
  });

  it('extracts the contact name matching each message sender', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '+1 202 555 0100', phone_number_id: '456' },
                contacts: [{ profile: { name: 'Ana García' }, wa_id: '573001234567' }],
                messages: [
                  {
                    from: '573001234567',
                    id: 'wamid-1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hola' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const parsed = adapter.parseInboundWebhook(payload);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].customerName).toBe('Ana García');
    expect(parsed[0].from).toBe('573001234567');
  });

  it('leaves customerName undefined when contacts are missing', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '+1 202 555 0100', phone_number_id: '456' },
                messages: [
                  {
                    from: '573001234567',
                    id: 'wamid-1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hola' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const parsed = adapter.parseInboundWebhook(payload);

    expect(parsed[0].customerName).toBeUndefined();
  });

  it('maps each sender to its own contact name', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '+1 202 555 0100', phone_number_id: '456' },
                contacts: [
                  { profile: { name: 'Ana' }, wa_id: '111' },
                  { profile: { name: 'Pedro' }, wa_id: '222' },
                ],
                messages: [
                  {
                    from: '111',
                    id: 'w1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'A' },
                  },
                  {
                    from: '222',
                    id: 'w2',
                    timestamp: '1700000001',
                    type: 'text',
                    text: { body: 'B' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const parsed = adapter.parseInboundWebhook(payload);

    expect(parsed.map((m) => m.customerName)).toEqual(['Ana', 'Pedro']);
  });
});

describe('WhatsAppAdapter.send', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid-out-1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends with dev credentials when no account is provided', async () => {
    const adapter = createAdapter({
      META_DEV_PHONE_NUMBER_ID: 'phone-id-1',
      META_DEV_ACCESS_TOKEN: 'dev-token',
    });

    const result = await adapter.send({
      businessId: 'biz-1',
      to: '573001234567',
      text: 'Hola',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/phone-id-1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer dev-token' }),
      }),
    );
    expect(result.externalMessageId).toBe('wamid-out-1');
  });

  it('sends with the business account credentials when provided (D1)', async () => {
    const adapter = createAdapter({ META_DEV_PHONE_NUMBER_ID: 'dev-phone' });
    const account: ChannelAccountData = {
      id: 'acc-1',
      businessId: 'biz-1',
      channel: 'whatsapp',
      accountId: 'phone-id-2',
      tokenEncrypted: 'iv:tag:data',
      isPrimary: true,
    };

    await adapter.send({ businessId: 'biz-1', to: '573001234567', text: 'Hola' }, account);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/phone-id-2/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer business-token' }),
      }),
    );
  });

  it('uses the configurable META_GRAPH_API_TIMEOUT_MS for the send timeout', async () => {
    const adapter = createAdapter({
      META_DEV_PHONE_NUMBER_ID: 'phone-id-1',
      META_DEV_ACCESS_TOKEN: 'dev-token',
      META_GRAPH_API_TIMEOUT_MS: 12000,
    });

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await adapter.send({ businessId: 'biz-1', to: '573001234567', text: 'Hola' });

    // El primer setTimeout con delay != 0 es el timeout del AbortController.
    const delays = setTimeoutSpy.mock.calls
      .map((args) => args[1] as number | undefined)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    expect(delays).toContain(12000);
    setTimeoutSpy.mockRestore();
  });

  it('throws when no account and no dev phone number id is configured', async () => {
    const adapter = createAdapter();

    await expect(
      adapter.send({ businessId: 'biz-1', to: '573001234567', text: 'Hola' }),
    ).rejects.toThrow('META_DEV_PHONE_NUMBER_ID not configured');
  });

  it('falls back to the dev token when the account token cannot be decrypted', async () => {
    const config = {
      getOrThrow: () => 'app-secret',
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'META_GRAPH_API_VERSION') return 'v21.0';
        if (key === 'META_DEV_PHONE_NUMBER_ID') return 'phone-id-1';
        if (key === 'META_DEV_ACCESS_TOKEN') return 'dev-token';
        return undefined;
      }),
    } as unknown as ConfigService;
    const crypto = {
      decrypt: vi.fn().mockImplementation(() => {
        throw new Error('bad key');
      }),
    } as unknown as CryptoService;
    const adapter = new WhatsAppAdapter(config, crypto);
    const account: ChannelAccountData = {
      id: 'acc-1',
      businessId: 'biz-1',
      channel: 'whatsapp',
      accountId: 'phone-id-2',
      tokenEncrypted: 'iv:tag:data',
      isPrimary: true,
    };

    await adapter.send({ businessId: 'biz-1', to: '573001234567', text: 'Hola' }, account);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/phone-id-2/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer dev-token' }),
      }),
    );
  });
});
