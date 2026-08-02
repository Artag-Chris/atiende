import { Global, Module } from '@nestjs/common';
import { CloudPricingUpdaterService } from './cloud-pricing-updater.service';
import { ExchangeRateUpdaterService } from './exchange-rate-updater.service';
import { PricingScheduler } from './pricing.scheduler';

/**
 * Módulo de pricing: crons (semanal cloud, diario dólar) que alimentan
 * CloudPricing y ExchangeRate. Los jobs corren en la cola MAINTENANCE y los
 * despacha MaintenanceProcessor (importa este módulo para inyectar los updaters).
 */
@Global()
@Module({
  providers: [CloudPricingUpdaterService, ExchangeRateUpdaterService, PricingScheduler],
  exports: [CloudPricingUpdaterService, ExchangeRateUpdaterService],
})
export class PricingModule {}
