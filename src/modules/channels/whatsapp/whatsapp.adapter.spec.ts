import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';

function createAdapter() {
  const config = {
    getOrThrow: () => 'app-secret',
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'META_GRAPH_API_VERSION') return 'v21.0';
      return undefined;
    }),
  } as unknown as ConfigService;
  return new WhatsAppAdapter(config);
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
