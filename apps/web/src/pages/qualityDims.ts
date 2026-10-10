/** 质量评分维度（单一来源，被 QualityPage / WritingPage 共享） */
export const QUALITY_DIMS = [
  { key: 'literature', label: '文献充分性' },
  { key: 'logic', label: '逻辑一致性' },
  { key: 'citation', label: '引用规范' },
  { key: 'language', label: '语言质量' },
  { key: 'novelty', label: '创新性' },
  { key: 'figures', label: '图表' },
  { key: 'format', label: '格式' },
] as const;

export type QualityDimKey = (typeof QUALITY_DIMS)[number]['key'];
