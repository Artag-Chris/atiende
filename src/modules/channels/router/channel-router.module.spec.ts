import { describe, it, expect } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { ChannelRouterModule } from './channel-router.module';
import { ChannelRouterService } from './channel-router.service';
import { WhatsAppAdapter } from '../whatsapp/whatsapp.adapter';

function makeConfigService() {
  return {
    getOrThrow: (key: string) => (key === 'META_APP_SECRET' ? 'secret' : 'value'),
    get: (key: string) => (key === 'META_GRAPH_API_VERSION' ? 'v21.0' : undefined),
  } as unknown as ConfigService;
}

@Global()
@Module({
  providers: [
    {
      provide: WhatsAppAdapter,
      useFactory: (configService: ConfigService) => new WhatsAppAdapter(configService),
      inject: [ConfigService],
    },
    { provide: ConfigService, useValue: makeConfigService() },
  ],
  exports: [WhatsAppAdapter],
})
class TestChannelProvidersModule {}

describe('ChannelRouterModule (DI wiring)', () => {
  it('agrega el adapter de WhatsApp a CHANNEL_PROVIDERS_TOKEN cuando el canal está activo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestChannelProvidersModule, ChannelRouterModule],
    }).compile();
    await moduleRef.init();

    const providers = moduleRef.get(CHANNEL_PROVIDERS_TOKEN);
    expect(Array.isArray(providers)).toBe(true);
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(WhatsAppAdapter);
    expect(moduleRef.get(ChannelRouterService).channels()).toEqual(['whatsapp']);
  });

  it('resuelve CHANNEL_PROVIDERS_TOKEN como array vacío cuando no hay canales activos', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ChannelRouterModule],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(CHANNEL_PROVIDERS_TOKEN)).toEqual([]);
    expect(moduleRef.get(ChannelRouterService).channels()).toEqual([]);
  });
});
