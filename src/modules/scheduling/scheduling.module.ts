import { Global, Module } from '@nestjs/common';
import { CALL_SCHEDULER_TOKEN } from '@core/tokens';
import { EmailCallScheduler } from './email-call-scheduler.service';

/**
 * Módulo de agendamiento de llamadas. Expone CALL_SCHEDULER_TOKEN con el
 * adapter actual (email + DB). A futuro, un adapter Cal.com puede reemplazarlo
 * cambiando el provider aquí — el core y la tool no cambian.
 */
@Global()
@Module({
  providers: [
    EmailCallScheduler,
    { provide: CALL_SCHEDULER_TOKEN, useExisting: EmailCallScheduler },
  ],
  exports: [CALL_SCHEDULER_TOKEN],
})
export class SchedulingModule {}
