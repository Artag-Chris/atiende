import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { parseMetaMessagingWebhook, verifyMetaSignature } from './meta-webhook.parser';

describe('parseMetaMessagingWebhook', () => {
  it('parses an Instagram DM webhook (object: instagram)', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400123456789',
          time: 1700000000000,
          messaging: [
            {
              sender: { id: 'IGSID-12345' },
              recipient: { id: '17841400123456789' },
              timestamp: 1699999999000,
              message: { mid: 'm_ig_1', text: 'Hola desde Instagram' },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaMessagingWebhook(payload);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      externalAccountId: '17841400123456789',
      from: 'IGSID-12345',
      externalMessageId: 'm_ig_1',
      type: 'text',
      text: 'Hola desde Instagram',
    });
    expect(parsed[0].timestamp).toEqual(new Date(1699999999000));
  });

  it('parses a Messenger (page) webhook', () => {
    const payload = {
      object: 'page',
      entry: [
        {
          id: '10987654321',
          messaging: [
            {
              sender: { id: 'PSID-98765' },
              recipient: { id: '10987654321' },
              timestamp: 1700000000000,
              message: { mid: 'm_page_1', text: 'Hola' },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaMessagingWebhook(payload);

    expect(parsed[0].externalAccountId).toBe('10987654321');
    expect(parsed[0].from).toBe('PSID-98765');
    expect(parsed[0].externalMessageId).toBe('m_page_1');
  });

  it('skips echoes of our own messages (is_echo)', () => {
    const payload = {
      object: 'page',
      entry: [
        {
          id: '10987654321',
          messaging: [
            {
              sender: { id: '10987654321' },
              recipient: { id: 'PSID-98765' },
              message: { mid: 'm_echo', text: 'Hola', is_echo: true },
            },
            {
              sender: { id: 'PSID-98765' },
              recipient: { id: '10987654321' },
              message: { mid: 'm_real', text: 'Buenos días' },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaMessagingWebhook(payload);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].externalMessageId).toBe('m_real');
  });

  it('skips messages sent by the business itself (is_self)', () => {
    const payload = {
      object: 'page',
      entry: [
        {
          id: '10987654321',
          messaging: [
            {
              sender: { id: '10987654321' },
              recipient: { id: 'PSID-98765' },
              message: { mid: 'm_self', text: 'Gracias por escribir', is_self: true },
            },
            {
              sender: { id: 'PSID-98765' },
              recipient: { id: '10987654321' },
              message: { mid: 'm_real', text: 'De nada' },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaMessagingWebhook(payload);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].externalMessageId).toBe('m_real');
  });

  it('marks non-text content as unsupported', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400123456789',
          messaging: [
            {
              sender: { id: 'IGSID-12345' },
              recipient: { id: '17841400123456789' },
              message: { mid: 'm_attach', attachments: [{ type: 'image' }] },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaMessagingWebhook(payload);

    expect(parsed[0].type).toBe('unsupported');
    expect(parsed[0].text).toBeUndefined();
  });

  it('ignores events without a message or without ids', () => {
    const parsed = parseMetaMessagingWebhook({
      object: 'page',
      entry: [
        { id: '10987654321', messaging: [] },
        { id: '10987654321', messaging: [{ sender: { id: 'x' }, recipient: { id: 'y' } }] },
      ],
    });

    expect(parsed).toHaveLength(0);
  });

  it('handles a top-level array payload defensively', () => {
    const parsed = parseMetaMessagingWebhook([
      {
        messaging: [
          {
            sender: { id: 'a' },
            recipient: { id: 'b' },
            message: { mid: 'm1', text: 'hi' },
          },
        ],
      },
    ]);

    expect(parsed).toHaveLength(1);
  });
});

describe('verifyMetaSignature', () => {
  it('accepts a valid sha256 HMAC', () => {
    const appSecret = 'app-secret';
    const body = '{"object":"page"}';
    const sig = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;

    expect(verifyMetaSignature(appSecret, body, sig)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    expect(verifyMetaSignature('app-secret', '{"object":"page"}', 'sha256=deadbeef')).toBe(false);
  });

  it('accepts the raw hex form (no sha256= prefix)', () => {
    const appSecret = 'app-secret';
    const body = 'body';
    const hex = createHmac('sha256', appSecret).update(body).digest('hex');

    expect(verifyMetaSignature(appSecret, body, hex)).toBe(true);
  });
});
