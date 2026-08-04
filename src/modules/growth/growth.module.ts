import { Module } from '@nestjs/common';
import { PostgresPersistenceModule } from '../persistence/postgres/postgres-persistence.module';
import { GrowthController } from './growth.controller';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { GrowthAdvisorService } from './growth-advisor.service';

@Module({
  imports: [PostgresPersistenceModule],
  controllers: [GrowthController],
  providers: [GrowthAnalyticsService, GrowthAdvisorService],
})
export class GrowthModule {}
