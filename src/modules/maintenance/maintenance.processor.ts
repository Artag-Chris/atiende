import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '@config/queue.config';
import { ExpireEscalationsUseCase } from '@core/use-cases/expire-escalations';

const EXPIRE_ESCALATIONS_JOB = 'expire-escalations';

@Processor(QUEUE_NAMES.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly expireEscalations: ExpireEscalationsUseCase,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === EXPIRE_ESCALATIONS_JOB) {
      await this.runEscalationExpiry();
      return;
    }
    this.logger.warn(`Unknown maintenance job: ${job.name}`);
  }

  private async runEscalationExpiry(): Promise<void> {
    const expiryHours = Number(this.config.get<number>('ESCALATION_EXPIRY_HOURS') ?? 72);
    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);
    const expired = await this.expireEscalations.execute(cutoff);
    this.logger.log(`Escalation expiry sweep done: ${expired} expired`);
  }
}
