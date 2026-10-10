import { Module } from '@nestjs/common';
import { WebSearchService } from './websearch.service';
import { WebSearchController } from './websearch.controller';

@Module({
  providers: [WebSearchService],
  controllers: [WebSearchController],
  exports: [WebSearchService],
})
export class WebSearchModule {}
