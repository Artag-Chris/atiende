import { Global, Module } from '@nestjs/common';
import {
  AGENT_RUN_REPOSITORY_TOKEN,
  BUSINESS_REPOSITORY_TOKEN,
  CONVERSATION_REPOSITORY_TOKEN,
  MESSAGE_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
} from '@core/tokens';
import { PrismaModule } from './prisma.module';
import { BusinessRepository } from './business.repository';
import { ConversationRepository } from './conversation.repository';
import { MessageRepository } from './message.repository';
import { AgentRunRepository } from './agent-run.repository';
import { InboundMessageRepository } from './inbound-message.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    BusinessRepository,
    ConversationRepository,
    MessageRepository,
    AgentRunRepository,
    InboundMessageRepository,
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
      provide: MESSAGE_REPOSITORY_TOKEN,
      useExisting: MessageRepository,
    },
    {
      provide: INBOUND_MESSAGE_REPOSITORY_TOKEN,
      useExisting: InboundMessageRepository,
    },
  ],
  exports: [
    BusinessRepository,
    ConversationRepository,
    MessageRepository,
    AgentRunRepository,
    InboundMessageRepository,
    AGENT_RUN_REPOSITORY_TOKEN,
    BUSINESS_REPOSITORY_TOKEN,
    CONVERSATION_REPOSITORY_TOKEN,
    MESSAGE_REPOSITORY_TOKEN,
    INBOUND_MESSAGE_REPOSITORY_TOKEN,
  ],
})
export class PostgresPersistenceModule {}
