import { Global, Module } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';

/**
 * 通用横切能力（全局）：项目归属校验等。
 * 设为 @Global 是为了让任意业务模块（projects/documents/...）无需逐个 import。
 */
@Global()
@Module({
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class CommonModule {}
