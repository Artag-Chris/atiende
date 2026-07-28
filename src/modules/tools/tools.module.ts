import { Global, Module } from '@nestjs/common';
import { TOOL_MODULES_TOKEN } from '@core/tokens';
import { GetBusinessInfoTool } from './get-business-info/get-business-info.tool';
import { EscalateToHumanTool } from './escalate-to-human/escalate-to-human.tool';
import { SearchCatalogTool } from './search-catalog/search-catalog.tool';
import { GetProductTool } from './get-product/get-product.tool';
import { CreateOrderTool } from './create-order/create-order.tool';
import { SearchKnowledgeTool } from './search-knowledge/search-knowledge.tool';

@Global()
@Module({
  providers: [
    GetBusinessInfoTool,
    EscalateToHumanTool,
    SearchCatalogTool,
    GetProductTool,
    CreateOrderTool,
    SearchKnowledgeTool,
    {
      provide: TOOL_MODULES_TOKEN,
      useFactory: (
        info: GetBusinessInfoTool,
        escalation: EscalateToHumanTool,
        search: SearchCatalogTool,
        getProduct: GetProductTool,
        createOrder: CreateOrderTool,
        searchKnowledge: SearchKnowledgeTool,
      ) => [info, escalation, search, getProduct, createOrder, searchKnowledge],
      inject: [GetBusinessInfoTool, EscalateToHumanTool, SearchCatalogTool, GetProductTool, CreateOrderTool, SearchKnowledgeTool],
    },
  ],
  exports: [TOOL_MODULES_TOKEN],
})
export class ToolsModule {}
