import { Injectable } from '@nestjs/common';
import type {
  ResponsePolicyPort,
  ToneConfig,
  ScopeCheckResult,
} from '@core/ports/response-policy.port';
import { ScopeClassifier } from './scope-classifier.service';
import { ResponseValidator } from './response-validator.service';
import {
  DEFAULT_TONE,
  buildTonePrompt,
  HALLUCINATION_PREVENTION_PROMPT,
  SCOPE_PROMPT,
} from './tone.config';

@Injectable()
export class ResponsePolicyService implements ResponsePolicyPort {
  constructor(
    private readonly scopeClassifier: ScopeClassifier,
    private readonly responseValidator: ResponseValidator,
  ) {}

  async checkScope(
    businessId: string,
    message: string,
    businessName?: string,
  ): Promise<ScopeCheckResult> {
    const result = await this.scopeClassifier.classify(businessId, message);

    if (!result.inScope) {
      return {
        allowed: false,
        rejectionMessage: this.buildRejectionMessage(businessName),
      };
    }
    return { allowed: true };
  }

  buildSystemPromptExtras(businessName?: string, tone?: ToneConfig): string {
    const t = tone ?? DEFAULT_TONE;
    const name = businessName ?? 'el negocio';
    const scopePrompt = SCOPE_PROMPT.replace(/\[nombre del negocio\]/g, name);
    return [buildTonePrompt(t), HALLUCINATION_PREVENTION_PROMPT, scopePrompt].join('\n\n');
  }

  validateResponse(response: string, context: { message: string; businessName?: string }) {
    return this.responseValidator.validate(response, context);
  }

  private buildRejectionMessage(businessName?: string): string {
    const name = businessName ?? 'nuestro negocio';
    return `Lo siento, solo puedo ayudarte con temas relacionados con ${name}. ¿Hay algo sobre nuestros productos o servicios en lo que pueda asistirte?`;
  }
}
