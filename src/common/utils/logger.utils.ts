type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type NestLogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';

export function mapLogLevels(level: PinoLevel): NestLogLevel[] {
  const order: NestLogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];
  const mapped: NestLogLevel = level === 'trace' ? 'verbose' : level === 'info' ? 'log' : level;
  const idx = order.indexOf(mapped);
  return order.slice(idx);
}
