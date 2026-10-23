/**
 * 契约测试的取值来源。
 *
 * 关键原则：**测试必须从产品代码取值，不能自己复制一份**。
 * 否则实现改了、测试里的副本没改，测试依然全绿（这正是本项目此前假测试的成因）。
 */
import { QUALITY_GATE_LABEL } from '../pipeline/pipeline.graph';
import { MOCK_OUTLINE } from '../ai/mock-gateway';

/** 质量门步骤文案（直接调用产品实现） */
export const QUALITY_GATE_OUTPUT = (score: number): string => QUALITY_GATE_LABEL(score);

/** mock 大纲（直接读取产品常量；返回可变副本，避免测试互相污染） */
export function mockOutlineFor(_topic: string): { title: string; sections: { title: string; subsections: string[] }[] } {
  return {
    title: MOCK_OUTLINE.title,
    sections: MOCK_OUTLINE.sections.map((s) => ({ title: s.title, subsections: [...s.subsections] })),
  };
}
