/**
 * 正文尾部块识别（单一来源）。
 *
 * 「尾部块」= 参考文献 / 图表 / 研究资料等附加段落，它们不属于论文正文：
 *  - 润色时不能被送进 LLM（会改写引文内容，学术诚信红线）
 *  - 引用体检时不计入锚点统计
 *
 * 历史问题：这条正则此前在两个文件里各写一份（pipeline.graph 与 documents.service），
 * 且都不识别 `研究资料`——该标题是本轮把知识库命中从正文分离出来时引入的，
 * 结果知识库参考块会被当作正文送润色。
 */

const TAIL_HEADINGS = ['参考文献', '引用文献', '图表', '研究资料', 'references'];

/** 匹配「尾部块」起始标题（任意 1-3 级标题 + 上述关键词） */
export const TAIL_BLOCK_REGEX = new RegExp(
  `\\n+#{1,3}\\s*(?:${TAIL_HEADINGS.join('|')})(?=[\\s（(:：\\-—]|$)[^\\n]*`,
  'gi',
);

/** 返回正文中最早的尾部块起点下标；没有尾部块返回 -1 */
export function findTailBlockStart(content: string): number {
  let cut = -1;
  for (const m of content.matchAll(TAIL_BLOCK_REGEX)) {
    const idx = m.index ?? -1;
    if (idx >= 0 && (cut === -1 || idx < cut)) cut = idx;
  }
  return cut;
}

/** 把正文拆成「可润色主体」与「原样保留的尾部块」 */
export function splitTailBlock(content: string): { body: string; tail: string } {
  const cut = findTailBlockStart(content);
  return cut >= 0 ? { body: content.slice(0, cut), tail: content.slice(cut) } : { body: content, tail: '' };
}

/**
 * 去掉正文里已存在的尾部块。
 * 用于「关闭起草」的重跑场景：若直接拿库里的旧正文再 render 一次，
 * 知识库参考 / 图表块会逐轮回炉重复累加。
 */
export function stripTailBlocks(content: string): string {
  return splitTailBlock(content).body.trimEnd();
}
