import { Global, Module } from '@nestjs/common';
import {
  AGENT_RUN_REPOSITORY_TOKEN,
  BUSINESS_REPOSITORY_TOKEN,
  CHANNEL_ACCOUNT_REPOSITORY_TOKEN,
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  UNIT_OF_WORK_TOKEN,
} from '@core/tokens';
import { PrismaModule } from './prisma.module';
import { BusinessRepository } from './business.repository';
import { ConversationRepository } from './conversation.repository';
import { ChannelAccountRepository } from './channel-account.repository';
import { MessageRepository } from './message.repository';
import { AgentRunRepository } from './agent-run.repository';
import { InboundMessageRepository } from './inbound-message.repository';
import { ProductRepository } from './product.repository';
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
  ],
  exports: [
    BusinessRepository,
    ConversationRepository,
    ChannelAccountRepository,
    MessageRepository,
    AgentRunRepository,
    InboundMessageRepository,
    ProductRepository,
    AGENT_RUN_REPOSITORY_TOKEN,
    BUSINESS_REPOSITORY_TOKEN,
    CONVERSATION_REPOSITORY_TOKEN,
    CHANNEL_ACCOUNT_REPOSITORY_TOKEN,
    MESSAGE_REPOSITORY_TOKEN,
    INBOUND_MESSAGE_REPOSITORY_TOKEN,
    UNIT_OF_WORK_TOKEN,
  ],
})
export class PostgresPersistenceModule {}
