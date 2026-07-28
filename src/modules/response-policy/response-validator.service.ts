import { Injectable, Logger } from '@nestjs/common';

export interface ValidationResult {
  approved: boolean;
  modified?: string;
  reason?: string;
}

@Injectable()
export class ResponseValidator {
  private readonly logger = new Logger(ResponseValidator.name);

  validate(
    response: string,
    context: { message: string; businessName?: string },
  ): ValidationResult {
    if (!response || response.trim().length === 0) {
      return { approved: false, reason: 'Respuesta vacía' };
    }

    const businessName = context.businessName ?? 'el negocio';
    const lower = response.toLowerCase();

    const hallucinationSignals = [
      /no tengo (información|datos).*pero/i,
      /según (mis|mi) (conocimiento|base de datos|registro)/i,
      /tengo entendido (que|de)/i,
      /he (leído|escuchado|visto) (que|sobre)/i,
      /no.*(seguro|estoy seguro).*pero/i,
    ];

    for (const signal of hallucinationSignals) {
      if (signal.test(lower)) {
        this.logger.warn(
          `Hallucination signal detected: "${signal.source}" in: "${response.slice(0, 100)}..."`,
        );
        return {
          approved: false,
          reason: 'Posible alucinación detectada',
          modified: `Lo siento, no tengo información suficiente sobre eso. ¿Hay algo más en lo que pueda ayudarte con respecto a ${businessName}?`,
        };
      }
    }

    return { approved: true };
  }
}
