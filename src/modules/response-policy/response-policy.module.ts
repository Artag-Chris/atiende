import { Global, Module } from '@nestjs/common';
import { ResponsePolicyService } from './response-policy.service';
import { ScopeClassifier } from './scope-classifier.service';
import { ResponseValidator } from './response-validator.service';
import { RESPONSE_POLICY_TOKEN } from '@core/tokens';

@Global()
@Module({
  providers: [
    ResponsePolicyService,
    ScopeClassifier,
    ResponseValidator,
    {
      provide: RESPONSE_POLICY_TOKEN,
      useExisting: ResponsePolicyService,
    },
  ],
  exports: [ResponsePolicyService, RESPONSE_POLICY_TOKEN],
})
export class ResponsePolicyModule {}
