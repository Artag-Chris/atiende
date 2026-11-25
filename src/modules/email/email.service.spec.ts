import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ResendEmailService, UnknownEmailDomainError } from './email.service';

const SAMPLE_DOMAINS = JSON.stringify([
  {
    domain: 'artagdev.com.co',
    apiKey: 're_artag_key',
    defaultFrom: 'Artag <info@artagdev.com.co>',
    displayName: 'Artag',
  },
  {
    domain: 'lumenxlabs.com.co',
    apiKey: 're_lumen_key',
    defaultFrom: 'Lumen X <info@lumenxlabs.com.co>',
    displayName: 'Lumen X',
  },
]);

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('ResendEmailService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists configured senders without exposing api keys and marks artagdev.com.co as default', () => {
    const service = new ResendEmailService(
      makeConfig({
        EMAIL_DOMAINS_CONFIG: SAMPLE_DOMAINS,
        EMAIL_DEFAULT_DOMAIN: 'artagdev.com.co',
      }),
    );

    expect(service.listSenders()).toEqual([
      {
        domain: 'artagdev.com.co',
        defaultFrom: 'Artag <info@artagdev.com.co>',
        displayName: 'Artag',
        isDefault: true,
      },
      {
        domain: 'lumenxlabs.com.co',
        defaultFrom: 'Lumen X <info@lumenxlabs.com.co>',
        displayName: 'Lumen X',
        isDefault: false,
      },
    ]);
  });

  it('sends using info@artagdev.com.co by default with reply_to and html', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const service = new ResendEmailService(
      makeConfig({
        EMAIL_DOMAINS_CONFIG: SAMPLE_DOMAINS,
        EMAIL_DEFAULT_DOMAIN: 'artagdev.com.co',
      }),
    );

    const sent = await service.send('cliente@empresa.com', 'Cotización', 'Hola <Juan>\n\nGracias.');

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_artag_key');
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      from: 'Artag <info@artagdev.com.co>',
      to: ['cliente@empresa.com'],
      reply_to: 'info@artagdev.com.co',
      subject: 'Cotización',
      text: 'Hola <Juan>\n\nGracias.',
    });
    expect(payload.html).toContain('Hola &lt;Juan&gt;');
  });

  it('switches apiKey and from when fromDomain is specified', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const service = new ResendEmailService(
      makeConfig({
        EMAIL_DOMAINS_CONFIG: SAMPLE_DOMAINS,
        EMAIL_DEFAULT_DOMAIN: 'artagdev.com.co',
      }),
    );

    await service.send('cliente@empresa.com', 'Hola', 'Mensaje', {
      fromDomain: 'lumenxlabs.com.co',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer re_lumen_key');
    const payload = JSON.parse(init.body);
    expect(payload.from).toBe('Lumen X <info@lumenxlabs.com.co>');
    expect(payload.reply_to).toBe('info@lumenxlabs.com.co');
  });

  it('throws UnknownEmailDomainError when requesting an unconfigured domain', async () => {
    const service = new ResendEmailService(
      makeConfig({
        EMAIL_DOMAINS_CONFIG: SAMPLE_DOMAINS,
      }),
    );

    await expect(
      service.send('cliente@empresa.com', 'Hola', 'Mensaje', { fromDomain: 'otro.com' }),
    ).rejects.toThrow(UnknownEmailDomainError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when no provider credentials are configured', async () => {
    const service = new ResendEmailService(makeConfig({}));
    const sent = await service.send('cliente@empresa.com', 'Hola', 'Mensaje');
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
