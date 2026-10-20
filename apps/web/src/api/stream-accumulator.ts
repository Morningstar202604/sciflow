/**
 * 流式累积的唯一语义定义。
 *
 * `streamChat` 的 onDelta / onReasoning 回调参数是**累积全文**（不是增量分片），
 * 这是 OpenAI 兼容网关逐块拼装后的结果。消费方必须「赋值覆盖」而不是「字符串追加」；
 * 追加会导致内容平方膨胀（历史缺陷 D1，实测 5 个分片后长度 10 → 31）。
 *
 * 把这条规则收成一个纯函数，页面统一调用，避免每个调用点各自理解一次。
 */
export interface StreamAggregate {
  content: string;
  reasoning: string;
}

export interface StreamDeltaInput {
  content?: string;
  reasoning?: string;
}

/**
 * 应用一次流式回调。
 * - 入参是累积值 → 直接覆盖；
 * - 入参为空串 → 保留原值（空分片不该清空已有内容）。
 */
export function applyStreamDelta(prev: StreamAggregate, next: StreamDeltaInput): StreamAggregate {
  return {
    content: typeof next.content === 'string' && next.content.length > 0 ? next.content : prev.content,
    reasoning: typeof next.reasoning === 'string' && next.reasoning.length > 0 ? next.reasoning : prev.reasoning,
  };
}
