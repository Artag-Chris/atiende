import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  controllers: [WhatsAppController],
  providers: [],
  exports: [],
})
export class WhatsAppModule {}
