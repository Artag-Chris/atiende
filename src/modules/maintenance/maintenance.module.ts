import { Module } from '@nestjs/common';
import { PostgresPersistenceModule } from '../persistence/postgres/postgres-persistence.module';
import { QueueModule } from '../queue/queue.module';
import { PricingModule } from '../pricing/pricing.module';
import { ExpireEscalationsUseCase } from '@core/use-cases/expire-escalations';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

@Module({
  imports: [PostgresPersistenceModule, QueueModule, PricingModule],
  providers: [ExpireEscalationsUseCase, MaintenanceProcessor, MaintenanceScheduler],
  exports: [ExpireEscalationsUseCase],
})
export class MaintenanceModule {}
