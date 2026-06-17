import { Logger } from '@nestjs/common';

export function setupForceShutdown(timeoutMs: number, logger: Logger): void {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  signals.forEach((signal) => {
    process.once(signal, () => {
      logger.warn(`Received ${signal}. Allowing ${timeoutMs}ms to drain...`);
      setTimeout(() => {
        logger.error(`Shutdown timeout (${timeoutMs}ms) exceeded. Forcing exit.`);
        process.exit(1);
      }, timeoutMs).unref();
    });
  });
}
