import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';

/**
 * 轻量全局输入校验（零新增依赖兜底）：
 * 项目未安装 class-validator/class-transformer，且全部控制器 body 为内联对象类型
 * （运行时 metatype 为 Object，Nest ValidationPipe 即便安装也不会真正剥字段）。
 * 因此这里只做不破坏现有端点的基本安全约束：
 *  - 仅作用于 @Body() 负载（param/query 原样放行）；
 *  - body 为 undefined/null 时放行（兼容可选 body 的端点）；
 *  - body 必须是普通 JSON 对象，拒绝数组/字符串/数字等非法负载（防非法 Content-Type 注入）。
 * 不做白名单剥字段——内联类型无运行时字段白名单，剥字段只会误伤合法请求。
 */
@Injectable()
export class InputValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') return value;
    if (value === undefined || value === null) return value;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    return value;
  }
}
