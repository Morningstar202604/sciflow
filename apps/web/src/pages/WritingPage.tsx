import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { BookOpen, Check, ChevronRight, ClipboardCheck, Eye, FileText, FlaskConical, Languages, ListTree, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { ChatPanel } from './ChatPanel';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { CitationRow, Doc, Outline, Project, Reference, ResearchDesignResult, SimulatedReviewResult } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Input, Select, Spinner, Textarea, jsonText } from '../components/ui';

export function WritingPage({ project, initialDocId }: { project: Project; initialDocId: string | null }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState<string | null>(initialDocId);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [content, setContent] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [sectionTarget, setSectionTarget] = useState('');
  const [polishResult, setPolishResult] = useState<{ original: string; polished: string; reason: string } | null>(null);
  const [polishMode, setPolishMode] = useState<'polish' | 'reduce'>('polish');
  const [translateTarget, setTranslateTarget] = useState<'zh' | 'en'>('zh');
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>('split');
  const toast = useContext(ToastContext);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [history, setHistory] = useState<{ type: string; original: string; polished: string; reason: string }[]>([]);
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  const [exportFormat, setExportFormat] = useState('apa');
  const [exported, setExported] = useState<string[]>([]);
  const [abstractResult, setAbstractResult] = useState<{ abstract: string; keywords: string[] } | null>(null);
  const [designResult, setDesignResult] = useState<ResearchDesignResult | null>(null);
  const [designIdea, setDesignIdea] = useState('');
  const [reviewResult, setReviewResult] = useState<SimulatedReviewResult | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDocs = useCallback(async () => {
    const list = await api.documents.list(project.id);
    setDocs(list);
    setDocId((prev) => (list.some((d) => d.id === prev) ? prev : (list[0]?.id ?? null)));
  }, [project.id]);

  useEffect(() => {
    loadDocs().catch((e) => setError(e.message));
    api.references.list(project.id).then(setRefs).catch(() => setRefs([]));
  }, [loadDocs, project.id]);

  useEffect(() => {
    if (!docId) {
      setDoc(null);
      setContent('');
      setOutline(null);
      return;
    }
    api.documents
      .get(docId)
      .then((d) => {
        setDoc(d);
        setContent(d.content ?? '');
        setOutline(jsonText<Outline | null>(d.outline, null));
      })
      .catch((e) => setError(e.message));
  }, [docId]);

  useEffect(() => {
    if (docId) {
      api.documents.citations(docId).then(setCitations).catch(() => setCitations([]));
      api.documents.polishRecords(docId).then(setHistory).catch(() => setHistory([]));
    }
  }, [docId]);

  // 防抖自动保存
  useEffect(() => {
    if (!docId || content === doc?.content) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const updated = await api.documents.update(docId, { content });
      setDoc(updated);
      setSavedAt(Date.now());
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, docId, doc?.content]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setAiBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const createDoc = async () => {
    const title = window.prompt('新文档标题', '');
    if (!title) return;
    const d = await api.documents.create(project.id, title.trim());
    setDocs((s) => [...s, d]);
    setDocId(d.id);
  };

  const removeDoc = async (id: string) => {
    if (!window.confirm('删除该文档？')) return;
    await api.documents.remove(id);
    setDocs((s) => s.filter((d) => d.id !== id));
    if (docId === id) setDocId(null);
  };

  const generateOutline = () =>
    run(async () => {
      const o = await api.documents.outline(docId!, topicInput || doc?.title || '');
      toast('success', '大纲已生成');
      setOutline(o);
      setDoc((d) => (d ? { ...d, outline: JSON.stringify(o) } : d));
      setShowOutlinePanel(true);
    });

  const draftSection = (title: string) =>
    run(async () => {
      const { text } = await api.documents.section(docId!, title);
      setContent((c) => (c ? `${c}\n\n${text}` : text));
    });

  const doPolish = (mode: 'polish' | 'reduce') =>
    run(async () => {
      const target = window.getSelection()?.toString()?.trim() || content;
      if (!target) throw new Error('请先在编辑器中选中文本，或保证文档有内容');
      const r = await api.documents.polish(docId!, target, mode);
      setPolishResult(r);
      setHistory((h) => [{ type: mode, original: r.original, polished: r.polished, reason: r.reason }, ...h]);
    });

  const doTranslate = () =>
    run(async () => {
      const target = window.getSelection()?.toString()?.trim() || content;
      if (!target) throw new Error('请选择要翻译的文本');
      const { translated } = await api.documents.translate(docId!, target, translateTarget);
      setPolishResult({ original: target, polished: translated, reason: `学术翻译（${translateTarget === 'zh' ? '英→中' : '中→英'}）` });
    });

  const applyPolished = () => {
    if (!polishResult) return;
    if (window.getSelection()?.toString()) {
      // 简单处理：全部替换
      setContent((c) => c.replace(polishResult.original, polishResult.polished) || polishResult.polished);
    } else {
      setContent(polishResult.polished);
    }
    setPolishResult(null);
  };

  const addCitation = async (referenceId: string) => {
    await run(async () => {
      await api.documents.addCitation(docId!, { referenceId, location: 'current', context: content.slice(-200) });
      setCitations(await api.documents.citations(docId!));
    });
  };

  const exportRefs = (format: string) =>
    run(async () => {
      const list = await api.documents.exportCitations(docId!, format);
      setExported(list);
      setExportFormat(format);
    });

  /** 导出 Word(.docx)——交稿/投稿刚需 */
  const exportWord = async () => {
    if (!doc) return;
    try {
      setAiBusy(true);
      const { base64, filename } = await api.documents.exportDocx(doc.id);
      const bytes = atob(base64);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('success', 'Word 文档已导出（含标题/大纲/正文/参考文献）');
    } catch {
      toast('error', 'Word 导出失败');
    } finally {
      setAiBusy(false);
    }
  };

  /** 导出全文 Markdown（标题+大纲+正文+引用） */
  const exportFullDoc = () =>
    run(async () => {
      const { markdown, filename } = await api.documents.exportMarkdown(docId!);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setError('');
    });

  /** 科研加强：生成论文摘要 + 关键词（AI） */
  const generateAbstract = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文，再生成摘要');
      const r = await api.documents.abstract(docId!);
      setAbstractResult(r);
      toast('success', '摘要与关键词已生成');
    });

  /** 科研加强：研究设计诊断（选题阶段：新颖性/可行性/风险/下一步） */
  const runDesignReview = () =>
    run(async () => {
      if (!designIdea.trim()) throw new Error('请先描述你的研究想法');
      const r = await api.research.designReview(designIdea.trim(), refs.map((x) => ({ title: x.title, year: x.year, venue: x.venue, abstract: x.abstract || '' })));
      setDesignResult(r);
      toast('success', '研究设计诊断完成');
    });

  /** 科研加强：模拟同行评审（3 位审稿人 + 主编综合决定） */
  const runSimulatedReview = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文');
      const r = await api.research.review(doc?.title || '未命名论文', content);
      setReviewResult(r);
      toast('success', '模拟同行评审完成');
    });

  /** 科研加强：导出 LaTeX 全文（标题 + 摘要占位 + 正文 + GB/T 7714 参考文献） */
  const exportLatex = async () => {
    try {
      setAiBusy(true);
      const cites = await api.documents.exportCitations(docId!, 'gbt');
      const esc = (t: string) => (t || '').replace(/([\\{}_$&%#])/g, (m) => `\\${m}`).replace(/\n/g, '\n\n');
      const tex = `% Generated by SciFlow (LaTeX export)
\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage[numbers]{natbib}

\\title{${esc(doc?.title || 'Untitled')}}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
% TODO: 在此填写摘要（可在左侧 AI 工具一键生成）
\\end{abstract}

\\section*{Introduction}
% TODO: 引言

${(content || '')
  .split(/\n\s*##+\s*/)
  .map((part, i) => (i === 0 ? part : `\\section{${esc(part.split('\n')[0])}}
${part.split('\n').slice(1).join('\n')}`))
  .join('\n\n')}

\\bibliographystyle{plainnat}
${cites.length ? `\\begin{thebibliography}{${cites.length}}
${cites.map((c, i) => `\\bibitem{ref${i + 1}} ${esc(c)}`).join('\n')}
\\end{thebibliography}` : '\\bibliography{refs}'}

\\end{document}
`;
      const blob = new Blob([tex], { type: 'application/x-tex;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${doc?.title || 'paper'}.tex`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('success', 'LaTeX 文件已导出（可用 Overleaf / TeXStudio 编译）');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAiBusy(false);
    }
  };

  if (!doc) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-6">
          <Empty text="还没有文档" />
          <div className="flex justify-center">
            <Button onClick={createDoc}>
              <Plus size={15} /> 新建文档
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 文档标签栏 */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto shrink-0 pb-1">
        {docs.map((d) => (
          <div
            key={d.id}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap cursor-pointer border ${
              docId === d.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-teal-300'
            }`}
            onClick={() => setDocId(d.id)}
          >
            <FileText size={13} />
            {d.title}
            <button
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                removeDoc(d.id);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <Button variant="outline" onClick={createDoc} className="px-2.5 py-1">
          <Plus size={14} />
        </Button>
      </div>

      <ErrorBox message={error} />

      <div className="flex-1 flex gap-4 min-h-0">
        {/* 大纲栏 */}
        <Card className={`w-60 shrink-0 p-3 overflow-y-auto flex flex-col ${showOutlinePanel ? '' : 'hidden md:flex'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <ListTree size={14} /> 大纲
            </span>
            <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setShowOutlinePanel((v) => !v)}>
              {showOutlinePanel ? '隐藏' : '显示'}
            </Button>
          </div>
          {!outline ? (
            <div className="text-xs text-slate-400 dark:text-slate-500">暂无大纲。输入主题生成：</div>
          ) : (
            <div className="space-y-1.5">
              <div className="font-medium text-slate-800 dark:text-slate-100 text-sm mb-1">{outline.title}</div>
              {outline.sections?.map((s, i) => (
                <div key={i} className="group">
                  <button
                    className="flex items-center gap-1 w-full text-left text-sm text-slate-600 dark:text-slate-300 hover:text-teal-700 py-1 rounded"
                    onClick={() => draftSection(s.title)}
                    title="点击起草此章节"
                  >
                    <ChevronRight size={13} className="shrink-0" />
                    <span className="truncate">{s.title}</span>
                    <Sparkles size={12} className="opacity-0 group-hover:opacity-100 ml-auto text-teal-500 shrink-0" />
                  </button>
                  {s.subsections?.length > 0 && (
                    <div className="ml-4 space-y-0.5 text-xs text-slate-400 dark:text-slate-500">
                      {s.subsections.map((sub, j) => (
                        <div key={j}>· {sub}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
            <Input placeholder="研究方向 / 论文主题" value={topicInput} onChange={(e) => setTopicInput(e.target.value)} />
            <Button className="w-full mt-2" onClick={generateOutline} disabled={aiBusy || !docId}>
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI 生成大纲
            </Button>
          </div>
        </Card>

        {/* 内联 AI 写作助手：问答全程贯通当前文档，快捷润色/翻译/摘要 */}
        <ChatPanel
          project={project}
          doc={doc}
          onDocUpdated={async (patch) => {
            if (!doc) return;
            try {
              await api.documents.update(doc.id, patch);
              setDoc((prev) => (prev ? { ...prev, ...patch } : prev));
            } catch {
              toast('error', '保存到文档失败');
            }
          }}
        />
        {/* 编辑器 */}
        <Card className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <input
              className="font-medium text-slate-800 dark:text-slate-100 outline-none flex-1 bg-transparent"
              defaultValue={doc.title}
              onBlur={async (e) => {
                const t = e.target.value.trim();
                if (t && t !== doc.title) {
                  const updated = await api.documents.update(docId!, { title: t });
                  setDoc(updated);
                  setDocs((s) => s.map((d) => (d.id === updated.id ? updated : d)));
                }
              }}
            />
            {savedAt && <span className="text-xs text-emerald-500 flex items-center gap-1 page-in"><Check size={12} />已保存</span>}
            <Badge tone="blue">v{doc.version}</Badge>
            {/* Markdown 预览切换（编辑 / 预览 / 分栏，科研写作标配） */}
            <div className="flex items-center gap-0.5 ml-auto bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {(['edit', 'split', 'preview'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEditorMode(m)}
                  title={m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-all duration-150 ${
                    editorMode === m ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/25' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {m === 'edit' ? <Pencil size={11} /> : m === 'preview' ? <Eye size={11} /> : <FileText size={11} />}
                  {m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
                </button>
              ))}
            </div>
          </div>
          <div className={`flex-1 min-h-0 ${editorMode === 'split' ? 'flex' : ''}`}>
            {editorMode !== 'preview' && (
              <Textarea
                className={`flex-1 border-0 rounded-none focus:ring-0 focus:border-0 p-4 text-[13.5px] leading-relaxed ${editorMode === 'split' ? 'w-1/2 border-r border-slate-100 dark:border-slate-800' : 'w-full'}`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在这里撰写论文正文（支持 Markdown）…可使用右侧 AI 工具：大纲生成、章节起草、润色、翻译、降重"
              />
            )}
            {editorMode !== 'edit' && (
              <div className={`flex-1 overflow-y-auto p-4 text-[13.5px] leading-relaxed prose prose-sm prose-headings:font-semibold prose-a:text-teal-600 dark:prose-invert ${editorMode === 'split' ? 'w-1/2' : 'w-full'}`}>
                {content.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {content}
                  </ReactMarkdown>
                ) : (
                  <div className="text-slate-400 dark:text-slate-500 text-sm">预览区：开始撰写后将实时渲染 Markdown 效果（标题、加粗、引用、列表、代码块等）。</div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* AI 工具面板 */}
        <Card className="w-72 shrink-0 p-3 overflow-y-auto hidden lg:block">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-1.5">
            <Sparkles size={14} className="brand-gradient-text" /> AI 工具
          </div>

          {aiBusy && <Spinner label="AI 正在处理…" />}

          {/* 科研加强：摘要 + 关键词 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">论文摘要 + 关键词（AI 一键生成）</div>
            <Button variant="outline" className="text-xs w-full" onClick={generateAbstract} disabled={aiBusy || !content.trim()}>
              <Sparkles size={12} className="text-teal-600" /> 生成摘要与关键词
            </Button>
            {abstractResult && (
              <div className="mt-2 text-xs bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded p-2 text-slate-700 dark:text-slate-300">
                <div className="font-medium text-teal-700 dark:text-teal-300 mb-1">摘要</div>
                <div className="mb-2 leading-relaxed">{abstractResult.abstract}</div>
                <div className="font-medium text-teal-700 dark:text-teal-300 mb-1">关键词</div>
                <div className="flex flex-wrap gap-1">
                  {abstractResult.keywords.map((k, i) => (
                    <span key={i} className="bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 rounded px-1.5 py-0.5">{k}</span>
                  ))}
                </div>
                <button
                  className="mt-2 text-teal-600 dark:text-teal-400 underline"
                  onClick={() => {
                    const tail = `\n\n**摘要**：${abstractResult.abstract}\n\n**关键词**：${abstractResult.keywords.join('、')}`;
                    setContent((c) => (c.endsWith('\n\n') ? c + tail.trimStart() : c + tail));
                    setAbstractResult(null);
                  }}
                >
                  插入到正文顶部
                </button>
              </div>
            )}
          </div>

          {/* 科研加强：研究设计诊断 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">研究设计诊断（选题阶段：新颖性 / 可行性 / 风险）</div>
            <Textarea
              rows={2}
              placeholder="描述你的研究想法，如：用图神经网络预测蛋白质-药物相互作用…"
              value={designIdea}
              onChange={(e) => setDesignIdea(e.target.value)}
              className="mb-2"
            />
            <Button variant="outline" className="text-xs w-full" onClick={runDesignReview} disabled={aiBusy || !designIdea.trim()}>
              <FlaskConical size={12} className="text-teal-600" /> 诊断研究想法
            </Button>
            {designResult && !('error' in designResult) && (
              <div className="mt-2 text-xs space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1 rounded-lg border border-teal-200 dark:border-teal-800 p-2">
                    <div className="text-teal-700 dark:text-teal-300 font-medium mb-0.5">新颖性 {designResult.noveltyScore}/100</div>
                    <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{designResult.noveltyFeedback}</div>
                  </div>
                  <div className="flex-1 rounded-lg border border-sky-200 dark:border-sky-800 p-2">
                    <div className="text-sky-700 dark:text-sky-300 font-medium mb-0.5">可行性 {designResult.feasibilityScore}/100</div>
                    <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{designResult.feasibilityFeedback}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <div className="text-slate-500 dark:text-slate-400 mb-0.5">建议方法</div>
                  <div className="flex flex-wrap gap-1">{designResult.methods.map((m, i) => <span key={i} className="bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-slate-600 dark:text-slate-300">{m}</span>)}</div>
                </div>
                <div className="rounded-lg border border-amber-100 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-900/10 p-2">
                  <div className="text-amber-600 dark:text-amber-400 mb-0.5">风险</div>
                  <ul className="list-disc pl-4 text-slate-600 dark:text-slate-300">{designResult.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <div className="text-teal-600 dark:text-teal-400 mb-0.5">下一步</div>
                  <ol className="list-decimal pl-4 text-slate-600 dark:text-slate-300">{designResult.nextSteps.map((n, i) => <li key={i}>{n}</li>)}</ol>
                </div>
              </div>
            )}
          </div>

          {/* 章节起草 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">章节起草（点击大纲章节或选择）</div>
            <Select
              options={[
                { value: '', label: '选择要起草的章节…' },
                ...(outline?.sections || []).map((s) => ({ value: s.title, label: s.title })),
              ]}
              value={sectionTarget}
              onChange={(v) => {
                setSectionTarget(v);
                if (v) draftSection(v);
              }}
            />
          </div>

          {/* 润色 / 降重 / 翻译 */}
          <div className="mb-4 space-y-2">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">润色 / 降重 / 翻译（默认处理全文，也可先选中文本）</div>
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={() => doPolish('polish')} disabled={aiBusy}>
                学术润色
              </Button>
              <Button className="flex-1" variant="outline" onClick={() => doPolish('reduce')} disabled={aiBusy}>
                降重改写
              </Button>
            </div>
            <div className="flex gap-2">
              <Select
                className="flex-1"
                options={[
                  { value: 'zh', label: '英 → 中' },
                  { value: 'en', label: '中 → 英' },
                ]}
                value={translateTarget}
                onChange={(v) => setTranslateTarget(v as 'zh' | 'en')}
              />
              <Button className="flex-1" variant="outline" onClick={doTranslate} disabled={aiBusy}>
                <Languages size={14} /> 翻译
              </Button>
            </div>
          </div>

          {/* 科研加强：模拟同行评审 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">模拟同行评审（投稿前：3 审稿人 + 主编决定）</div>
            <Button variant="outline" className="text-xs w-full" onClick={runSimulatedReview} disabled={aiBusy || !content.trim()}>
              <ClipboardCheck size={12} className="text-teal-600" /> 模拟评审全文
            </Button>
            {reviewResult && !('error' in reviewResult) && (
              <div className="mt-2 text-xs space-y-2">
                <div className="rounded-lg bg-teal-50/60 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-2">
                  <div className="text-teal-700 dark:text-teal-300 font-medium mb-0.5">主编决定：{reviewResult.verdict}</div>
                  <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{reviewResult.overall}</div>
                </div>
                {reviewResult.reviewers.map((rv, i) => (
                  <div key={i} className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{rv.role}</span>
                      <Badge tone={rv.score >= 80 ? 'green' : rv.score >= 60 ? 'amber' : 'red'}>{rv.score} 分</Badge>
                    </div>
                    <div className="text-slate-600 dark:text-slate-300 mb-1">👍 {rv.strengths.join('；')}</div>
                    <div className="text-slate-500 dark:text-slate-400 mb-1">⚠ {rv.concerns.join('；')}</div>
                    <div className="text-teal-600 dark:text-teal-400">建议：{rv.suggestion}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 润色结果对比 */}
          {polishResult && (
            <Card className="p-3 mb-4 bg-slate-50 dark:bg-slate-900/50 border-teal-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-teal-700">三段式结果</span>
                <Button variant="success" className="px-2 py-0.5 text-xs" onClick={applyPolished}>
                  应用到正文
                </Button>
              </div>
              <div className="text-xs space-y-2">
                <div>
                  <div className="text-slate-400 dark:text-slate-500 mb-0.5">原文</div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-600 dark:text-slate-300 max-h-28 overflow-y-auto">{polishResult.original}</div>
                </div>
                <div>
                  <div className="text-slate-400 dark:text-slate-500 mb-0.5">润色后</div>
                  <div className="bg-white dark:bg-slate-900 border border-emerald-200 rounded p-2 text-slate-800 dark:text-slate-100 max-h-28 overflow-y-auto">{polishResult.polished}</div>
                </div>
                <div>
                  <div className="text-slate-400 dark:text-slate-500 mb-0.5">理由</div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-500 dark:text-slate-400">{polishResult.reason}</div>
                </div>
              </div>
            </Card>
          )}

          {/* 引用管理 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
              <BookOpen size={12} /> 引用管理（文献库 {refs.length} 条）
            </div>
            {refs.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">文献库为空，请先到「文献调研」检索导入</div>
            ) : (
              <select
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-xs bg-white dark:bg-slate-900"
                onChange={(e) => e.target.value && addCitation(e.target.value)}
                value=""
              >
                <option value="">选择文献加入引用…</option>
                {refs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title.slice(0, 40)}
                  </option>
                ))}
              </select>
            )}
            {citations.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">已引用 {citations.length} 条</div>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {citations.map((c) => (
                    <div key={c.id} className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded px-2 py-1">
                      <span className="truncate flex-1">{c.reference.title}</span>
                      {c.verified ? <Badge tone="green">DOI✓</Badge> : <Badge>未核验</Badge>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-1.5 mt-2">
              <Select
                className="flex-1 text-xs"
                options={[
                  { value: 'apa', label: 'APA' },
                  { value: 'ieee', label: 'IEEE' },
                  { value: 'vancouver', label: 'Vancouver' },
                  { value: 'gbt', label: 'GB/T 7714' },
                  { value: 'bibtex', label: 'BibTeX (.bib)' },
                ]}
                value={exportFormat}
                onChange={(v) => exportRefs(v)}
              />
              <Button variant="outline" className="text-xs" onClick={() => exportRefs(exportFormat)} disabled={citations.length === 0}>
                导出引用
              </Button>
            </div>
            {exported.length > 0 && (
              <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded p-2 text-xs text-slate-600 dark:text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {exported.map((e, i) => (
                  <div key={i} className="mb-1">
                    {e}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
              <div className="flex gap-1.5">
                <Button variant="outline" className="text-xs flex-1" onClick={exportFullDoc} disabled={!doc}>
                  导出全文 Markdown
                </Button>
                <Button variant="outline" className="text-xs flex-1" onClick={exportLatex} disabled={!doc}>
                  导出 LaTeX
                </Button>
                <Button variant="outline" className="text-xs flex-1" onClick={exportWord} disabled={!doc || aiBusy}>
                  {aiBusy ? '生成中…' : '导出 Word'}
                </Button>
              </div>
            </div>
          </div>

          {/* 历史记录 */}
          {history.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">润色 / 翻译历史（可追溯）</div>
              <div className="space-y-1.5">
                {history.slice(0, 6).map((h, i) => (
                  <details key={i} className="bg-slate-50 dark:bg-slate-900/50 rounded p-2 text-xs">
                    <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                      {h.type === 'polish' ? '润色' : h.type === 'reduce' ? '降重' : '翻译'} · {new Date().toLocaleTimeString()}
                    </summary>
                    <div className="mt-1 text-slate-400 dark:text-slate-500 max-h-20 overflow-y-auto">{h.reason}</div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
