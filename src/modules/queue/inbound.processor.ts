import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, type InboundMessageJobData } from '@config/queue.config';
import { ProcessInboundMessageUseCase } from '@core/use-cases/process-inbound-message';
import { ChannelRouterService } from '@modules/channels/router/channel-router.service';

@Processor(QUEUE_NAMES.INBOUND_MESSAGE)
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(
    private readonly processInbound: ProcessInboundMessageUseCase,
    private readonly channels: ChannelRouterService,
  ) {
    super();
  }

  async process(job: Job<InboundMessageJobData>): Promise<void> {
    this.logger.log(
      `Processing inbound message job ${job.id} for business=${job.data.businessId} channel=${job.data.channel} phone=${job.data.customerPhone}`,
    );

    try {
      const result = await this.processInbound.execute({
        channel: job.data.channel,
        externalAccountId: job.data.externalAccountId,
        from: job.data.customerPhone,
        text: job.data.text,
        externalMessageId: job.data.externalMessageId,
        rawPayload: job.data.rawPayload,
        customerName: job.data.customerName,
      });

      if (result.responded && result.responseText) {
        const businessId = result.businessId ?? job.data.businessId;
        if (!businessId) {
          throw new Error('Inbound message responded but no businessId to send');
        }
        await this.channels.send(job.data.channel, {
          businessId,
          to: job.data.customerPhone,
          text: result.responseText,
        });
        this.logger.log(`Response sent to ${job.data.customerPhone} via ${job.data.channel}`);
      }

      // At-least-once: si el send lanzó excepción nunca llegamos aquí y el job
      // se reintenta. Si no hubo nada que enviar (escalado/dedup) o el send
      // fue exitoso, marcamos processed para que un retry del webhook no
      // vuelva a procesar el mensaje.
      if (result.inboundMessageId) {
        await this.processInbound.markProcessed(result.inboundMessageId);
      }

      this.logger.log(`Inbound message job ${job.id} completed: responded=${result.responded}`);
    } catch (error) {
      this.logger.error(`Inbound message job ${job.id} failed: ${error}`);
      throw error;
    }
  }
}
