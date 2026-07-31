import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@config/queue.config';

const EXPIRE_ESCALATIONS_JOB = 'expire-escalations';

/**
 * Programa los jobs repeatable de mantenimiento al arrancar. El jobId fijo hace
 * el add idempotente (BullMQ reemplaza el repeat existente), y Redis deduplica
 * entre instancias.
 */
@Injectable()
export class MaintenanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.MAINTENANCE) private readonly maintenanceQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const intervalHours = Number(this.config.get<number>('ESCALATION_EXPIRY_INTERVAL_HOURS') ?? 6);

    try {
      await this.maintenanceQueue.add(
        EXPIRE_ESCALATIONS_JOB,
        {},
        {
          jobId: EXPIRE_ESCALATIONS_JOB,
          repeat: { every: intervalHours * 60 * 60 * 1000 },
        },
      );
      this.logger.log(
        `Scheduled '${EXPIRE_ESCALATIONS_JOB}' every ${intervalHours}h (maintenance queue)`,
      );
    } catch (error) {
      this.logger.warn(`Failed to schedule maintenance job (Redis unavailable?): ${error}`);
    }
  }
}
