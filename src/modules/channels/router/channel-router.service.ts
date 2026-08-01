import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Channel } from '@core/domain/types';
import type {
  ChannelProviderPort,
  OutboundMessage,
  SendResult,
} from '@core/ports/channel-provider.port';
import type { ChannelAccountRepositoryPort } from '@core/ports/channel-account-repository.port';
import { CHANNEL_ACCOUNT_REPOSITORY_TOKEN, CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';

/** Canal sin provider registrado. Si el flag de features activó el canal, es un bug de wiring. */
export class ChannelProviderNotFoundError extends Error {
  constructor(channel: string) {
    super(`No channel provider registered for channel "${channel}"`);
    this.name = 'ChannelProviderNotFoundError';
  }
}

/**
 * Rutea el tráfico entrante/saliente al provider correcto según el canal.
 * Se registra como multi-binding bajo CHANNEL_PROVIDERS_TOKEN: cada canal
 * (WhatsAppModule, InstagramModule, ...) aporta su adapter.
 *
 * El core (procesador, dashboard) llama a este service con `channel` y nunca
 * conoce la implementación concreta de cada canal.
 */
@Injectable()
export class ChannelRouterService {
  private readonly logger = new Logger(ChannelRouterService.name);
  private readonly byChannel = new Map<Channel, ChannelProviderPort>();

  constructor(
    @Optional()
    @Inject(CHANNEL_PROVIDERS_TOKEN)
    private readonly providers: ChannelProviderPort[] | undefined,
    @Inject(CHANNEL_ACCOUNT_REPOSITORY_TOKEN)
    private readonly accountRepo: ChannelAccountRepositoryPort,
  ) {
    for (const provider of providers ?? []) {
      this.byChannel.set(provider.name, provider);
    }
  }

  getProvider(channel: Channel): ChannelProviderPort {
    const provider = this.byChannel.get(channel);
    if (!provider) {
      throw new ChannelProviderNotFoundError(channel);
    }
    return provider;
  }

  async send(channel: Channel, message: OutboundMessage): Promise<SendResult> {
    const account = await this.accountRepo.findForBusiness(channel, message.businessId);
    return this.getProvider(channel).send(message, account ?? undefined);
  }

  async isHealthy(channel: Channel): Promise<boolean> {
    return this.getProvider(channel).isHealthy();
  }

  channels(): Channel[] {
    return [...this.byChannel.keys()];
  }
}
