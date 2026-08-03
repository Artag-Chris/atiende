import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER_TOKEN } from '@core/tokens';
import { ResendEmailService } from './email.service';

@Global()
@Module({
  providers: [ResendEmailService, { provide: EMAIL_SENDER_TOKEN, useExisting: ResendEmailService }],
  exports: [EMAIL_SENDER_TOKEN],
})
export class EmailModule {}
