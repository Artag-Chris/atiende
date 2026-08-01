import type { Channel as PrismaChannel } from '@prisma/client';
import type { Channel } from '@core/domain/types';

const DOMAIN_TO_PRISMA: Record<Channel, PrismaChannel> = {
  whatsapp: 'WHATSAPP',
  web_chat: 'WEB_CHAT',
  telegram: 'TELEGRAM',
  instagram: 'INSTAGRAM',
  messenger: 'MESSENGER',
};

const PRISMA_TO_DOMAIN: Record<PrismaChannel, Channel> = {
  WHATSAPP: 'whatsapp',
  WEB_CHAT: 'web_chat',
  TELEGRAM: 'telegram',
  INSTAGRAM: 'instagram',
  MESSENGER: 'messenger',
};

export function toPrismaChannel(channel: Channel): PrismaChannel {
  return DOMAIN_TO_PRISMA[channel];
}

export function toDomainChannel(channel: PrismaChannel): Channel {
  return PRISMA_TO_DOMAIN[channel];
}
