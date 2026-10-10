#!/usr/bin/env node
/**
 * CSL 官方样式内嵌生成器（一次性维护工具）
 *
 * 从 citation-style-language/styles 官方仓库拉取缺失样式，
 * 生成 apps/server/src/documents/csl-templates.ts（XML 内嵌为 TS 字符串）。
 * 内嵌而非 fs 读取：tsc 纯编译即可携带，无构建后拷贝步骤、无运行时路径问题。
 *
 * 重新生成：node scripts/gen-csl-templates.mjs
 * 样式来源：https://github.com/citation-style-language/styles（社区 CSL 标准样式库）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outPath = path.join(root, 'apps', 'server', 'src', 'documents', 'csl-templates.ts');

/** 产品内 format 值 → 官方 CSL 样式文件名 */
const TEMPLATES = [
  ['ieee', 'ieee.csl'],
  ['gbt', 'chinese-gb7714-2005-numeric.csl'],
  ['nature', 'nature.csl'],
  ['chicagoAuthorDate', 'chicago-author-date-16th-edition.csl'],
  ['springerBasic', 'springer-basic-author-date.csl'],
  ['acs', 'american-chemical-society.csl'],
];

const CDN = 'https://cdn.jsdelivr.net/gh/citation-style-language/styles@master';

function toConstName(key) {
  // camelCase → SNAKE_CASE
  return key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

async function main() {
  const blocks = [];
  for (const [key, file] of TEMPLATES) {
    const url = `${CDN}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 ${url}: ${res.status}`);
    const xml = await res.text();
    if (!xml.includes('<style')) throw new Error(`内容异常（非 CSL）：${file}`);
    // 模板字符串安全：转义反引号与 ${（CSL XML 实际不含，防御性处理）
    const safe = xml.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    blocks.push(
      `/** ${file} · 源自 citation-style-language/styles（${CDN}/${file}） */\nexport const ${toConstName(key)}_CSL = \`${safe}\`;`,
    );
    console.log(`[gen] ${file} → ${toConstName(key)}_CSL (${(xml.length / 1024).toFixed(1)} KB)`);
  }

  const header = `/**
 * 官方 CSL 样式模板（内嵌字符串）
 *
 * ⚠️ 本文件由 scripts/gen-csl-templates.mjs 生成，请勿手改；
 *    更新样式请改脚本里的 TEMPLATES 后重跑。
 *
 * 背景：citation-js 0.8.x 仅内置 apa/vancouver/harvard1 三种样式，
 *      其余 6 种（IEEE / GB-T 7714 / Nature / Chicago / Springer / ACS）
 *      需要在此用官方 API（plugins.config.get('@csl').styles.add）注册。
 */

`;

  fs.writeFileSync(outPath, header + blocks.join('\n\n') + '\n');
  console.log(`[gen] 已写出 ${path.relative(root, outPath)}`);
}

main().catch((e) => {
  console.error('[gen] 失败:', e);
  process.exit(1);
});
