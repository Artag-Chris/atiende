import { describe, it, expect } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CHANNEL_ACCOUNT_REPOSITORY_TOKEN, CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { ChannelRouterModule } from './channel-router.module';
import { ChannelRouterService } from './channel-router.service';
import { WhatsAppAdapter } from '../whatsapp/whatsapp.adapter';
import { InstagramAdapter } from '../instagram/instagram.adapter';
import { MessengerAdapter } from '../messenger/messenger.adapter';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import type { ChannelAccountRepositoryPort } from '@core/ports/channel-account-repository.port';

function makeConfigService() {
  return {
    getOrThrow: (key: string) => (key === 'META_APP_SECRET' ? 'secret' : 'value'),
    get: (key: string) => (key === 'META_GRAPH_API_VERSION' ? 'v21.0' : undefined),
  } as unknown as ConfigService;
}

const fakeCrypto = {
  encrypt: () => 'iv:tag:data',
  decrypt: () => 'token',
} as unknown as CryptoService;

const fakeAccountRepo: ChannelAccountRepositoryPort = {
  findForBusiness: async () => null,
};

@Global()
@Module({
  providers: [{ provide: CHANNEL_ACCOUNT_REPOSITORY_TOKEN, useValue: fakeAccountRepo }],
  exports: [CHANNEL_ACCOUNT_REPOSITORY_TOKEN],
})
class TestAccountRepoModule {}

@Global()
@Module({
  providers: [
    {
      provide: WhatsAppAdapter,
      useFactory: (configService: ConfigService, crypto: CryptoService) =>
        new WhatsAppAdapter(configService, crypto),
      inject: [ConfigService, CryptoService],
    },
    {
      provide: InstagramAdapter,
      useFactory: (configService: ConfigService, crypto: CryptoService) =>
        new InstagramAdapter(configService, crypto),
      inject: [ConfigService, CryptoService],
    },
    {
      provide: MessengerAdapter,
      useFactory: (configService: ConfigService, crypto: CryptoService) =>
        new MessengerAdapter(configService, crypto),
      inject: [ConfigService, CryptoService],
    },
    { provide: ConfigService, useValue: makeConfigService() },
    { provide: CryptoService, useValue: fakeCrypto },
  ],
  exports: [WhatsAppAdapter, InstagramAdapter, MessengerAdapter],
})
class TestChannelProvidersModule {}

describe('ChannelRouterModule (DI wiring)', () => {
  it('agrega los adapters de todos los canales activos a CHANNEL_PROVIDERS_TOKEN', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAccountRepoModule, TestChannelProvidersModule, ChannelRouterModule],
    }).compile();
    await moduleRef.init();

    const providers = moduleRef.get(CHANNEL_PROVIDERS_TOKEN);
    expect(Array.isArray(providers)).toBe(true);
    expect(providers).toHaveLength(3);
    expect(providers.map((p: { name: string }) => p.name).sort()).toEqual([
      'instagram',
      'messenger',
      'whatsapp',
    ]);
    expect(moduleRef.get(ChannelRouterService).channels().sort()).toEqual([
      'instagram',
      'messenger',
      'whatsapp',
    ]);
  });

  it('resuelve CHANNEL_PROVIDERS_TOKEN como array vacío cuando no hay canales activos', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAccountRepoModule, ChannelRouterModule],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(CHANNEL_PROVIDERS_TOKEN)).toEqual([]);
    expect(moduleRef.get(ChannelRouterService).channels()).toEqual([]);
  });
});
