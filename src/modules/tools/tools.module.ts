import { Global, Module } from '@nestjs/common';
import { TOOL_MODULES_TOKEN } from '@core/tokens';
import { GetBusinessInfoTool } from './get-business-info/get-business-info.tool';
import { EscalateToHumanTool } from './escalate-to-human/escalate-to-human.tool';
import { SearchCatalogTool } from './search-catalog/search-catalog.tool';
import { GetProductTool } from './get-product/get-product.tool';
import { CreateOrderTool } from './create-order/create-order.tool';
import { SearchKnowledgeTool } from './search-knowledge/search-knowledge.tool';
import { EstimatePriceTool } from './estimate-price/estimate-price.tool';
import { GetQuoteTool } from './get-quote/get-quote.tool';
import { ScheduleCallTool } from './schedule-call/schedule-call.tool';

@Global()
@Module({
  providers: [
    GetBusinessInfoTool,
    EscalateToHumanTool,
    SearchCatalogTool,
    GetProductTool,
    CreateOrderTool,
    SearchKnowledgeTool,
    EstimatePriceTool,
    GetQuoteTool,
    ScheduleCallTool,
    {
      provide: TOOL_MODULES_TOKEN,
      useFactory: (
        info: GetBusinessInfoTool,
        escalation: EscalateToHumanTool,
        search: SearchCatalogTool,
        getProduct: GetProductTool,
        createOrder: CreateOrderTool,
        searchKnowledge: SearchKnowledgeTool,
        estimatePrice: EstimatePriceTool,
        getQuote: GetQuoteTool,
        scheduleCall: ScheduleCallTool,
      ) => [
        info,
        escalation,
        search,
        getProduct,
        createOrder,
        searchKnowledge,
        estimatePrice,
        getQuote,
        scheduleCall,
      ],
      inject: [
        GetBusinessInfoTool,
        EscalateToHumanTool,
        SearchCatalogTool,
        GetProductTool,
        CreateOrderTool,
        SearchKnowledgeTool,
        EstimatePriceTool,
        GetQuoteTool,
        ScheduleCallTool,
      ],
    },
  ],
  exports: [TOOL_MODULES_TOKEN],
})
export class ToolsModule {}
