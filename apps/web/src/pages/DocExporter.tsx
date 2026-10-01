/**
 * DocExporter —— 写作页导出区独立 lazy chunk（P2 backlog 任务 1 & 2）
 *
 * 设计约束（体积红线）：
 *  - WritingPage 主 chunk 仅保留按钮挂载点（lazy + Suspense），本文件不被主 chunk 静态引入；
 *  - 所有 .tex / .html 生成逻辑、LaTeX 转义、手写 markdown→tex/html 转换、BibTeX 条目构建
 *    全部收口于此，仅在用户点击导出时才随本 chunk 加载。
 *  - 零新增 npm 依赖：纯字符串拼接 + Blob 下载。
 *
 * 导出物：
 *  1) 自包含 .tex：元数据头 / 章节结构 / 正文 LaTeX 转义 / 引用 → thebibliography + BibTeX 源条目 / ctex 中文编译注释
 *  2) 自包含单文件 .html：内联 CSS + 手写轻量 markdown 渲染 + 引用列表 + 元数据头，浏览器直接打开可读
 */
import { useContext } from 'react';
import { Button } from '../components/ui';
import { ToastContext } from '../App';
import type { CitationRow, Doc, Project, Reference } from '../types';

/* ------------------------------------------------------------------ */
/* LaTeX 转义与正文转换                                                 */
/* ------------------------------------------------------------------ */

/** LaTeX 特殊字符转义：\ { } & % $ # _ ~ ^（反斜杠最先处理） */
function escTex(t: string): string {
  return (t ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/** 行内格式：**粗** / `代码` / *斜体*（先转义再套命令） */
function inlineTex(t: string): string {
  let s = escTex(t);
  s = s.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}');
  s = s.replace(/`([^`]+)`/g, '\\texttt{$1}');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1\\emph{$2}');
  return s;
}

/** markdown 正文 → LaTeX 块结构（#/##/### → section/subsection/subsubsection，列表/段落分组） */
function mdToLatex(md: string): string {
  const lines = (md || '').split('\n');
  const out: string[] = [];
  let list: { type: 'itemize' | 'enumerate'; items: string[] } | null = null;
  const closeList = () => {
    if (!list) return;
    out.push(`\\begin{${list.type}}`);
    for (const it of list.items) out.push(`\\item ${inlineTex(it)}`);
    out.push(`\\end{${list.type}}`, '');
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lv = h[1].length;
      const cmd = lv <= 1 ? 'section' : lv === 2 ? 'subsection' : lv === 3 ? 'subsubsection' : 'paragraph';
      out.push(`\\${cmd}{${inlineTex(h[2])}}`, '');
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== 'itemize') { closeList(); list = { type: 'itemize', items: [] }; }
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!list || list.type !== 'enumerate') { closeList(); list = { type: 'enumerate', items: [] }; }
      list.items.push(ol[1]);
      continue;
    }
    closeList();
    if (!line.trim()) { out.push(''); continue; }
    out.push(inlineTex(line), '');
  }
  closeList();
  return out.join('\n').trim();
}

/**
 * 作者字段格式化——镜像 WritingPage 文末列表的 8 样式作者解析逻辑（本 chunk 独立，不复 import）：
 * 兼容字符串数组 ["Ashish Vaswani"] 与对象数组 [{"name":...}] / [{"family","given"}] 两种存储形态。
 * 输出 APA 风格作者串：`Vaswani, A.; Shazeer, N.`（姓在前 + 名字首字母缩写，分号分隔）。
 */
function authorToName(a: unknown): string {
  if (typeof a === 'string') return a.trim();
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
    if (typeof o.family === 'string' && o.family.trim()) {
      return typeof o.given === 'string' && o.given.trim() ? `${o.given.trim()} ${o.family.trim()}`.trim() : o.family.trim();
    }
  }
  return '';
}
function parseAuthorArr(authors: string | unknown[] | null | undefined): string[] {
  let raw: unknown = [];
  if (typeof authors === 'string') {
    try {
      raw = JSON.parse(authors || '[]');
    } catch {
      return [];
    }
  } else if (Array.isArray(authors)) {
    raw = authors;
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(authorToName).filter(Boolean);
}
/** "First Middle Last" -> "Last" */
function surnameOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : a.trim();
}
/** "First Middle Last" -> "F. M." */
function initialsOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  parts.pop();
  return parts.map((p) => p.charAt(0).toUpperCase()).join('. ') + (parts.length ? '.' : '');
}
/** -> "Vaswani, A.; Shazeer, N."；无作者返回空串（调用方自行降级 Anonymous） */
function formatAuthors(ref: Reference): string {
  const arr = parseAuthorArr(ref.authors);
  return arr
    .map((a) => {
      const ini = initialsOf(a);
      return ini ? `${surnameOf(a)}, ${ini}` : surnameOf(a);
    })
    .join('; ');
}

/** 单条 Reference → BibTeX 条目（@article / @inproceedings） */
function toBibtex(i: number, ref: Reference): string {
  const key = `ref${i + 1}`;
  const type = /proceeding|conference|workshop|symposium|会议/i.test(ref.venue || '') ? 'inproceedings' : 'article';
  const venueField = type === 'inproceedings' ? 'booktitle' : 'journal';
  const fields: [string, string][] = [];
  const authorsStr = formatAuthors(ref);
  if (authorsStr) fields.push(['author', authorsStr]);
  if (ref.year) fields.push(['year', String(ref.year)]);
  if (ref.title) fields.push(['title', ref.title]);
  if (ref.venue) fields.push([venueField, ref.venue]);
  if (ref.doi) fields.push(['doi', ref.doi]);
  if (ref.url) fields.push(['url', ref.url]);
  const body = fields
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `  ${k} = {${v.replace(/([{}])/g, '\\$1')}}`)
    .join(',\n');
  return `@${type}{${key},\n${body}\n}`;
}

/** 构建自包含 .tex 全文（导出供离线单测） */
export function buildTex(doc: Doc, content: string, citations: CitationRow[], project: Project): string {
  const title = doc?.title || 'Untitled';
  const author = 'Your Name'; // 占位：请在导出后替换为实际作者
  const date = new Date().toLocaleDateString('zh-CN');
  const body = mdToLatex(content || '');
  const bibItems = citations.length
    ? citations
        .map(
          (c, i) =>
            `\\bibitem{ref${i + 1}} ${inlineTex(formatAuthors(c.reference) || 'Anon')} (${c.reference.year || 'n.d.'}). ${inlineTex(
              c.reference.title,
            )}. ${inlineTex(c.reference.venue || '')}${c.reference.doi ? ` DOI: ${inlineTex(c.reference.doi)}` : ''}.`,
        )
        .join('\n')
    : '';
  const bibtexSrc = citations.map((c, i) => toBibtex(i, c.reference)).join('\n\n');

  return `% ============================================================================
% Generated by SciFlow —— 自包含 LaTeX 导出
% ----------------------------------------------------------------------------
% 中文编译说明：本文档含中文内容。
%   · 推荐使用 XeLaTeX / LuaLaTeX 编译（Overleaf 编译器选择 XeLaTeX 即可）；
%   · 若使用 pdfLaTeX，请取消下一行注释以启用 ctex 宏包：
% \\usepackage{ctex}
%   · 参考文献已内嵌为 thebibliography，开箱即可编译；
%     文末另附 BibTeX 源条目（refs*.bib），可改用 \\bibliography{refs} 工作流。
% 项目来源：${escTex(project?.name || 'SciFlow Project')}
% ============================================================================
\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage[margin=2.5cm]{geometry}
% \\usepackage{ctex}   % 含中文时取消本行注释，并以 XeLaTeX 编译

\\title{${inlineTex(title)}}
\\author{${author}}
\\date{${date}}

\\begin{document}
\\maketitle

${body || '% （正文为空）'}

${bibItems ? `\\begin{thebibliography}{${String(citations.length).padStart(2, '0')}}
${bibItems}
\\end{thebibliography}` : ''}

% ----------------------------------------------------------------------------
% BibTeX 源条目（可另存为 refs.bib）：
${bibtexSrc ? '% ' + bibtexSrc.split('\n').join('\n% ') : '% （本文档无引用）'}

\\end{document}
`;
}

/* ------------------------------------------------------------------ */
/* HTML 快照转换                                                       */
/* ------------------------------------------------------------------ */

function escHtml(t: string): string {
  return (t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineHtml(t: string): string {
  let s = escHtml(t);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

/** 手写轻量 markdown → HTML（标题/段落/粗斜体/行内代码/列表/代码块/引用块） */
function mdToHtml(md: string): string {
  const lines = (md || '').split('\n');
  const out: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let inCode = false;
  const codeBuf: string[] = [];
  const closeList = () => {
    if (!list) return;
    const tag = list.type;
    out.push(`<${tag}>` + list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('') + `</${tag}>`);
    list = null;
  };
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (inCode) {
        out.push('<pre><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
        codeBuf.length = 0;
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lv = Math.min(h[1].length, 6);
      out.push(`<h${lv}>${inlineHtml(h[2])}</h${lv}>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inlineHtml(quote[1])}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [] }; }
      list.items.push(ol[1]);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    out.push(`<p>${inlineHtml(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('<pre><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
  return out.join('\n');
}

/** 构建自包含单文件 HTML 快照（导出供离线单测） */
export function buildHtml(doc: Doc, content: string, citations: CitationRow[], project: Project): string {
  const title = doc?.title || 'Untitled';
  const body = mdToHtml(content || '');
  const refsHtml = citations.length
    ? `<h2>参考文献</h2>
<ol class="refs">
${citations
  .map(
    (c) =>
      `<li><span class="ref-authors">${escHtml(formatAuthors(c.reference) || 'Anon')}</span> (${escHtml(
        String(c.reference.year ?? 'n.d.'),
      )}). ${escHtml(c.reference.title)}. <em>${escHtml(c.reference.venue || '')}</em>${
        c.reference.doi ? `. DOI: <a href="https://doi.org/${escHtml(c.reference.doi)}">${escHtml(c.reference.doi)}</a>` : ''
      }.</li>`,
  )
  .join('\n')}
</ol>`
    : '';
  const date = new Date().toLocaleString('zh-CN');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         line-height: 1.75; color: #1f2937; background: #fafafa; max-width: 820px; margin: 0 auto; padding: 40px 24px; }
  .doc-head { border-bottom: 2px solid #0d9488; padding-bottom: 16px; margin-bottom: 28px; }
  h1 { font-size: 1.9rem; margin: 0 0 8px; }
  h2 { font-size: 1.35rem; margin-top: 1.8em; border-left: 4px solid #0d9488; padding-left: 10px; }
  h3 { font-size: 1.1rem; margin-top: 1.4em; }
  .meta { color: #6b7280; font-size: .85rem; }
  p { margin: .7em 0; }
  blockquote { border-left: 3px solid #d1d5db; margin: .8em 0; padding: .2em 1em; color: #4b5563; background: #f3f4f6; }
  code { background: #f3f4f6; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  pre { background: #1f2937; color: #e5e7eb; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: transparent; color: inherit; padding: 0; }
  ol.refs { padding-left: 1.4em; }
  ol.refs li { margin: .5em 0; font-size: .92rem; }
  .ref-authors { color: #0d9488; }
  a { color: #0d9488; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: .78rem; color: #9ca3af; }
  @media (prefers-color-scheme: dark) {
    body { background: #111827; color: #e5e7eb; }
    blockquote { background: #1f2937; color: #9ca3af; }
    code { background: #1f2937; }
  }
</style>
</head>
<body>
<header class="doc-head">
  <h1>${escHtml(title)}</h1>
  <div class="meta">项目：${escHtml(project?.name || 'SciFlow')} · 导出时间：${escHtml(date)}</div>
</header>
<main>
${body || '<p><em>（正文为空）</em></p>'}
${refsHtml}
</main>
<footer>由 SciFlow 生成的自包含 HTML 快照 · 无外部依赖，可离线阅读</footer>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* React 组件：导出按钮行（lazy 挂载点）                                */
/* ------------------------------------------------------------------ */

export function DocExporter({
  doc,
  content,
  citations,
  project,
  onExportFull,
  onExportWord,
  aiBusy,
}: {
  doc: Doc | null;
  content: string;
  citations: CitationRow[];
  project: Project;
  onExportFull: () => void;
  onExportWord: () => void;
  aiBusy?: boolean;
}) {
  const toast = useContext(ToastContext);

  const download = (filename: string, text: string, mime: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const exportTex = () => {
    if (!doc) return;
    if (!(content || '').trim()) {
      toast('error', '正文为空，无可导出的 .tex 内容');
      return;
    }
    try {
      const tex = buildTex(doc, content, citations, project);
      download(`${doc.title || 'paper'}.tex`, tex, 'application/x-tex;charset=utf-8');
      toast('success', citations.length ? `.tex 已导出（内嵌 ${citations.length} 条 BibTeX 条目，XeLaTeX 编译）` : '.tex 已导出（无引用，XeLaTeX 编译含中文）');
    } catch {
      toast('error', '.tex 导出失败');
    }
  };

  const exportHtml = () => {
    if (!doc) return;
    if (!(content || '').trim()) {
      toast('error', '正文为空，无可导出的 HTML 快照');
      return;
    }
    try {
      const html = buildHtml(doc, content, citations, project);
      download(`${doc.title || 'paper'}.html`, html, 'text/html;charset=utf-8');
      toast('success', 'HTML 快照已导出（单文件、可离线阅读）');
    } catch {
      toast('error', 'HTML 快照导出失败');
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button variant="outline" className="text-xs" onClick={onExportFull} disabled={!doc}>
        导出全文 Markdown
      </Button>
      <Button variant="outline" className="text-xs" onClick={exportTex} disabled={!doc} title="自包含 .tex：章节结构 + 正文转义 + BibTeX 引用">
        导出 LaTeX (.tex)
      </Button>
      <Button variant="outline" className="text-xs" onClick={exportHtml} disabled={!doc} title="自包含单文件 HTML，浏览器直接打开">
        导出 HTML 快照
      </Button>
      <Button variant="outline" className="text-xs" onClick={onExportWord} disabled={!doc || aiBusy}>
        {aiBusy ? '生成中…' : '导出 Word'}
      </Button>
    </div>
  );
}
