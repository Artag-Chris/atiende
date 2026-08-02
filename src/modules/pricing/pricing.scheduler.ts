import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@config/queue.config';

export const UPDATE_CLOUD_PRICING_JOB = 'update-cloud-pricing';
export const UPDATE_EXCHANGE_RATE_JOB = 'update-exchange-rate';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Programa los jobs repeatable de pricing al arrancar (cola MAINTENANCE):
 * - update-cloud-pricing: semanal.
 * - update-exchange-rate: diario.
 * JobId fijo → add idempotente (BullMQ reemplaza el repeat existente).
 */
@Injectable()
export class PricingScheduler implements OnModuleInit {
  private readonly logger = new Logger(PricingScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.MAINTENANCE) private readonly maintenanceQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<string>('FEATURE_PRICING_CRONS') !== 'false';

    if (!enabled) {
      this.logger.log('Pricing crons disabled (FEATURE_PRICING_CRONS=false)');
      return;
    }

    try {
      await this.maintenanceQueue.add(
        UPDATE_CLOUD_PRICING_JOB,
        {},
        { jobId: UPDATE_CLOUD_PRICING_JOB, repeat: { every: WEEK_MS } },
      );
      await this.maintenanceQueue.add(
        UPDATE_EXCHANGE_RATE_JOB,
        {},
        { jobId: UPDATE_EXCHANGE_RATE_JOB, repeat: { every: DAY_MS } },
      );
      this.logger.log(
        `Scheduled '${UPDATE_CLOUD_PRICING_JOB}' weekly and '${UPDATE_EXCHANGE_RATE_JOB}' daily (maintenance queue)`,
      );
    } catch (error) {
      this.logger.warn(`Failed to schedule pricing jobs (Redis unavailable?): ${error}`);
    }
  }
}
