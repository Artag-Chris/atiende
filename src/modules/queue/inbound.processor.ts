import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, type InboundMessageJobData } from '@config/queue.config';
import { ProcessInboundMessageUseCase } from '@core/use-cases/process-inbound-message';
import { WhatsAppAdapter } from '@modules/channels/whatsapp/whatsapp.adapter';

@Processor(QUEUE_NAMES.INBOUND_MESSAGE)
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(
    private readonly processInbound: ProcessInboundMessageUseCase,
    private readonly whatsapp: WhatsAppAdapter,
  ) {
    super();
  }

  async process(job: Job<InboundMessageJobData>): Promise<void> {
    this.logger.log(
      `Processing inbound message job ${job.id} for business=${job.data.businessId} phone=${job.data.customerPhone}`,
    );

    try {
      const result = await this.processInbound.execute({
        externalAccountId: job.data.businessId,
        from: job.data.customerPhone,
        text: job.data.text,
        externalMessageId: job.data.externalMessageId,
        rawPayload: job.data.rawPayload,
        customerName: job.data.customerName,
      });

      if (result.responded && result.responseText) {
        await this.whatsapp.send({
          businessId: job.data.businessId,
          to: job.data.customerPhone,
          text: result.responseText,
        });
        this.logger.log(`Response sent to ${job.data.customerPhone}`);
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
