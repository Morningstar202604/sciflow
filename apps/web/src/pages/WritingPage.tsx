import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronRight, FileText, Languages, ListTree, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { CitationRow, Doc, Outline, Project, Reference } from '../types';
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
  const [refs, setRefs] = useState<Reference[]>([]);
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [history, setHistory] = useState<{ type: string; original: string; polished: string; reason: string }[]>([]);
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  const [exportFormat, setExportFormat] = useState('apa');
  const [exported, setExported] = useState<string[]>([]);
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
              docId === d.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
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
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <ListTree size={14} /> 大纲
            </span>
            <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setShowOutlinePanel((v) => !v)}>
              {showOutlinePanel ? '隐藏' : '显示'}
            </Button>
          </div>
          {!outline ? (
            <div className="text-xs text-slate-400">暂无大纲。输入主题生成：</div>
          ) : (
            <div className="space-y-1.5">
              <div className="font-medium text-slate-800 text-sm mb-1">{outline.title}</div>
              {outline.sections?.map((s, i) => (
                <div key={i} className="group">
                  <button
                    className="flex items-center gap-1 w-full text-left text-sm text-slate-600 hover:text-indigo-700 py-1 rounded"
                    onClick={() => draftSection(s.title)}
                    title="点击起草此章节"
                  >
                    <ChevronRight size={13} className="shrink-0" />
                    <span className="truncate">{s.title}</span>
                    <Sparkles size={12} className="opacity-0 group-hover:opacity-100 ml-auto text-indigo-500 shrink-0" />
                  </button>
                  {s.subsections?.length > 0 && (
                    <div className="ml-4 space-y-0.5 text-xs text-slate-400">
                      {s.subsections.map((sub, j) => (
                        <div key={j}>· {sub}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-auto pt-3 border-t border-slate-100">
            <Input placeholder="研究方向 / 论文主题" value={topicInput} onChange={(e) => setTopicInput(e.target.value)} />
            <Button className="w-full mt-2" onClick={generateOutline} disabled={aiBusy || !docId}>
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI 生成大纲
            </Button>
          </div>
        </Card>

        {/* 编辑器 */}
        <Card className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
            <input
              className="font-medium text-slate-800 outline-none flex-1 bg-transparent"
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
            {savedAt && <span className="text-xs text-slate-400 flex items-center gap-1"><Check size={12} />已保存</span>}
            <Badge tone="blue">v{doc.version}</Badge>
          </div>
          <Textarea
            className="flex-1 border-0 rounded-none focus:ring-0 focus:border-0 p-4 text-[13.5px] leading-relaxed"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="在这里撰写论文正文…可使用右侧 AI 工具：大纲生成、章节起草、润色、翻译、降重"
          />
        </Card>

        {/* AI 工具面板 */}
        <Card className="w-72 shrink-0 p-3 overflow-y-auto hidden lg:block">
          <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
            <Sparkles size={14} className="text-indigo-600" /> AI 工具
          </div>

          {aiBusy && <Spinner label="AI 正在处理…" />}

          {/* 章节起草 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 mb-1.5">章节起草（点击大纲章节或选择）</div>
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
            <div className="text-xs font-medium text-slate-500 mb-1.5">润色 / 降重 / 翻译（默认处理全文，也可先选中文本）</div>
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

          {/* 润色结果对比 */}
          {polishResult && (
            <Card className="p-3 mb-4 bg-slate-50 border-indigo-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-indigo-700">三段式结果</span>
                <Button variant="success" className="px-2 py-0.5 text-xs" onClick={applyPolished}>
                  应用到正文
                </Button>
              </div>
              <div className="text-xs space-y-2">
                <div>
                  <div className="text-slate-400 mb-0.5">原文</div>
                  <div className="bg-white border border-slate-200 rounded p-2 text-slate-600 max-h-28 overflow-y-auto">{polishResult.original}</div>
                </div>
                <div>
                  <div className="text-slate-400 mb-0.5">润色后</div>
                  <div className="bg-white border border-emerald-200 rounded p-2 text-slate-800 max-h-28 overflow-y-auto">{polishResult.polished}</div>
                </div>
                <div>
                  <div className="text-slate-400 mb-0.5">理由</div>
                  <div className="bg-white border border-slate-200 rounded p-2 text-slate-500">{polishResult.reason}</div>
                </div>
              </div>
            </Card>
          )}

          {/* 引用管理 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
              <BookOpen size={12} /> 引用管理（文献库 {refs.length} 条）
            </div>
            {refs.length === 0 ? (
              <div className="text-xs text-slate-400">文献库为空，请先到「文献调研」检索导入</div>
            ) : (
              <select
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
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
                <div className="text-xs text-slate-500 mb-1">已引用 {citations.length} 条</div>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {citations.map((c) => (
                    <div key={c.id} className="flex items-center gap-1 text-xs text-slate-500 bg-slate-50 rounded px-2 py-1">
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
                ]}
                value={exportFormat}
                onChange={(v) => exportRefs(v)}
              />
              <Button variant="outline" className="text-xs" onClick={() => exportRefs(exportFormat)} disabled={citations.length === 0}>
                导出引用
              </Button>
            </div>
            {exported.length > 0 && (
              <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {exported.map((e, i) => (
                  <div key={i} className="mb-1">
                    {e}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 历史记录 */}
          {history.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1.5">润色 / 翻译历史（可追溯）</div>
              <div className="space-y-1.5">
                {history.slice(0, 6).map((h, i) => (
                  <details key={i} className="bg-slate-50 rounded p-2 text-xs">
                    <summary className="cursor-pointer text-slate-600">
                      {h.type === 'polish' ? '润色' : h.type === 'reduce' ? '降重' : '翻译'} · {new Date().toLocaleTimeString()}
                    </summary>
                    <div className="mt-1 text-slate-400 max-h-20 overflow-y-auto">{h.reason}</div>
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
