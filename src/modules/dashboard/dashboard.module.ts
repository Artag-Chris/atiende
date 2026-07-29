import { Module } from '@nestjs/common';
import { PostgresPersistenceModule } from '../persistence/postgres/postgres-persistence.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [PostgresPersistenceModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
