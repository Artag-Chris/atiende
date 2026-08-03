import { Global, Module } from '@nestjs/common';
import {
  AGENT_RUN_REPOSITORY_TOKEN,
  BUSINESS_REPOSITORY_TOKEN,
  CHANNEL_ACCOUNT_REPOSITORY_TOKEN,
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  UNIT_OF_WORK_TOKEN,
  CLOUD_PRICING_REPOSITORY_TOKEN,
  EXCHANGE_RATE_REPOSITORY_TOKEN,
  QUOTE_REPOSITORY_TOKEN,
  CALL_REQUEST_REPOSITORY_TOKEN,
} from '@core/tokens';
import { PrismaModule } from './prisma.module';
import { BusinessRepository } from './business.repository';
import { ConversationRepository } from './conversation.repository';
import { ChannelAccountRepository } from './channel-account.repository';
import { MessageRepository } from './message.repository';
import { AgentRunRepository } from './agent-run.repository';
import { InboundMessageRepository } from './inbound-message.repository';
import { ProductRepository } from './product.repository';
import { CloudPricingRepository } from './cloud-pricing.repository';
import { ExchangeRateRepository } from './exchange-rate.repository';
import { QuoteRepository } from './quote.repository';
import { CallRequestRepository } from './call-request.repository';
import { PostgresUnitOfWork } from './unit-of-work';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    BusinessRepository,
    ConversationRepository,
    ChannelAccountRepository,
    MessageRepository,
    AgentRunRepository,
    InboundMessageRepository,
    ProductRepository,
    CloudPricingRepository,
    ExchangeRateRepository,
    QuoteRepository,
    CallRequestRepository,
    PostgresUnitOfWork,
    {
      provide: AGENT_RUN_REPOSITORY_TOKEN,
      useExisting: AgentRunRepository,
    },
    {
      provide: BUSINESS_REPOSITORY_TOKEN,
      useExisting: BusinessRepository,
    },
    {
      provide: CONVERSATION_REPOSITORY_TOKEN,
      useExisting: ConversationRepository,
    },
    {
      provide: CHANNEL_ACCOUNT_REPOSITORY_TOKEN,
      useExisting: ChannelAccountRepository,
    },
    {
      provide: MESSAGE_REPOSITORY_TOKEN,
      useExisting: MessageRepository,
    },
    {
      provide: INBOUND_MESSAGE_REPOSITORY_TOKEN,
      useExisting: InboundMessageRepository,
    },
    {
      provide: UNIT_OF_WORK_TOKEN,
      useExisting: PostgresUnitOfWork,
    },
    {
      provide: CLOUD_PRICING_REPOSITORY_TOKEN,
      useExisting: CloudPricingRepository,
    },
    {
      provide: EXCHANGE_RATE_REPOSITORY_TOKEN,
      useExisting: ExchangeRateRepository,
    },
    {
      provide: QUOTE_REPOSITORY_TOKEN,
      useExisting: QuoteRepository,
    },
    {
      provide: CALL_REQUEST_REPOSITORY_TOKEN,
      useExisting: CallRequestRepository,
    },
  ],
  exports: [
    BusinessRepository,
    ConversationRepository,
    ChannelAccountRepository,
    MessageRepository,
    AgentRunRepository,
    InboundMessageRepository,
    ProductRepository,
    CloudPricingRepository,
    ExchangeRateRepository,
    QuoteRepository,
    CallRequestRepository,
    AGENT_RUN_REPOSITORY_TOKEN,
    BUSINESS_REPOSITORY_TOKEN,
    CONVERSATION_REPOSITORY_TOKEN,
    CHANNEL_ACCOUNT_REPOSITORY_TOKEN,
    MESSAGE_REPOSITORY_TOKEN,
    INBOUND_MESSAGE_REPOSITORY_TOKEN,
    UNIT_OF_WORK_TOKEN,
    CLOUD_PRICING_REPOSITORY_TOKEN,
    EXCHANGE_RATE_REPOSITORY_TOKEN,
    QUOTE_REPOSITORY_TOKEN,
    CALL_REQUEST_REPOSITORY_TOKEN,
  ],
})
export class PostgresPersistenceModule {}
