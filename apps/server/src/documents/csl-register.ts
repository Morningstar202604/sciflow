/**
 * CSL 官方样式注册（citation-js 0.8.x 补缺）
 *
 * 背景：@citation-js/plugin-csl 0.8.x 仅内置 apa / vancouver / harvard1 三种样式，
 *      产品支持的其余 6 种（IEEE / GB-T 7714 / Nature / Chicago / Springer / ACS）
 *      会在渲染时抛 "Cannot find style"。
 * 修复：用 citation-js 官方 API 注册内嵌的官方样式模板（见 csl-templates.ts，
 *      由 scripts/gen-csl-templates.mjs 从 citation-style-language/styles 生成）。
 * 幂等：模块级 Register.add 重复注册同名样式是覆盖语义，重复 import 安全。
 */

import { plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
// 官方 zh-CN locale：GB-T 7714 样式声明 default-locale="zh-CN"，citation-js 仅内置 5 种西文 locale，
// 缺 zh-CN 会导致 citeproc 引擎取词表崩溃（et-al undefined）。
import zhCnLocalePkg from '@citation/csl-locale-zh-cn';
import {
  IEEE_CSL,
  GBT_CSL,
  NATURE_CSL,
  CHICAGO_AUTHOR_DATE_CSL,
  SPRINGER_BASIC_CSL,
  ACS_CSL,
} from './csl-templates';

const cslConfig = plugins.config.get('@csl') as unknown as {
  styles: { add: (name: string, xml: string) => void };
  locales: { add: (name: string, xml: string) => void };
};

// ---------- 注册 zh-CN locale（GB-T 7714 必需） ----------
const localePkg = zhCnLocalePkg as unknown as { default?: { content?: string }; content?: string };
const zhCnXml = localePkg.default?.content || localePkg.content;
if (zhCnXml) {
  try {
    cslConfig.locales.add('zh-CN', zhCnXml);
  } catch (e) {
    console.warn(`[CSL] zh-CN locale 注册跳过: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------- 注册补缺样式 ----------
for (const [name, xml] of [
  ['ieee', IEEE_CSL],
  ['chinese-gb7714-2005-numeric', GBT_CSL],
  ['nature', NATURE_CSL],
  ['chicago-author-date-16th-edition', CHICAGO_AUTHOR_DATE_CSL],
  ['springer-basic-author-date', SPRINGER_BASIC_CSL],
  ['american-chemical-society', ACS_CSL],
] as const) {
  try {
    cslConfig.styles.add(name, xml);
  } catch (e) {
    // 已注册等非致命情况不阻断启动
    console.warn(`[CSL] 样式注册跳过 ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
