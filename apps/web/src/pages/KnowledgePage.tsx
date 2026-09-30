import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, ChevronDown, ChevronUp, FileText, Link2, Loader2, MessageSquare, Trash2, Unlink, Upload } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { KnowledgeDoc, KnowledgeQueryResult, Project, Reference } from '../types';
import { Button, Card, ConfirmDialog, Empty, ErrorBox, Input, SectionTitle, Textarea, Badge, Spinner } from '../components/ui';
import { Donut, HBar } from '../components/charts';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function KnowledgePage({ project }: { project: Project }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<KnowledgeQueryResult | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const toast = useContext(ToastContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null);
  // 文献库↔知识库打通（#5）：项目内可选文献 + 正在展开绑定下拉的文档
  const [refs, setRefs] = useState<Reference[]>([]);
  const [bindingDocId, setBindingDocId] = useState<string | null>(null);
  // 绑定下拉的标题搜索关键词（前端过滤 title/venue/年份）
  const [bindQuery, setBindQuery] = useState('');
  // RAG 引用可点（#17）：已展开原文的来源块（按 chunkId 记录）
  const [openChunks, setOpenChunks] = useState<Record<string, boolean>>({});

  const load = async () => {
    try {
      setDocs(await api.knowledge.list(project.id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const loadRefs = async () => {
    try {
      setRefs(await api.references.list(project.id));
    } catch {
      /* 文献库暂时不可用时不阻断知识库页 */
    }
  };

  useEffect(() => {
    load();
    loadRefs();
  }, [project.id]);

  /** 绑定/解除文献：referenceId 传 null 解除 */
  const bindRef = async (doc: KnowledgeDoc, referenceId: string | null) => {
    setError('');
    try {
      await api.knowledge.bind(doc.id, referenceId);
      toast('success', referenceId ? `已绑定「${refs.find((r) => r.id === referenceId)?.title || '文献'}」` : `已解除「${doc.name}」的文献绑定`);
      setBindingDocId(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleChunk = (key: string) => setOpenChunks((m) => ({ ...m, [key]: !m[key] }));

  // 绑定文献搜索：前端实时过滤 title / venue / 年份（数据已在 refs）
  const filteredRefs = useMemo(() => {
    const q = bindQuery.trim().toLowerCase();
    if (!q) return refs;
    return refs.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.venue || '').toLowerCase().includes(q) ||
        (r.year ? String(r.year).includes(q) : false),
    );
  }, [refs, bindQuery]);

  // 文档类型分布 Donut（pdf/markdown/text）
  const typeDist = useMemo(() => {
    const order: { key: string; label: string; color: string }[] = [
      { key: 'pdf', label: 'PDF', color: '#f87171' },
      { key: 'markdown', label: 'Markdown', color: '#0ea5e9' },
      { key: 'text', label: '纯文本', color: '#94a3b8' },
    ];
    const counts: Record<string, number> = { pdf: 0, markdown: 0, text: 0 };
    docs.forEach((d) => {
      if (d.type in counts) counts[d.type]++;
      else counts.text++;
    });
    return order.filter((o) => counts[o.key] > 0).map((o) => ({ label: o.label, value: counts[o.key], color: o.color }));
  }, [docs]);

  // 分块量 HBar（按 chunkCount 降序 Top 8）
  const chunkDist = useMemo(
    () =>
      [...docs]
        .sort((a, b) => b.chunkCount - a.chunkCount)
        .slice(0, 8)
        .map((d) => ({
          label: d.name.length > 22 ? d.name.slice(0, 22) + '…' : d.name,
          value: d.chunkCount,
          hint: d.name,
        })),
    [docs],
  );

  const uploadFile = async (file: File) => {
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const type = isPdf ? 'pdf' : file.name.toLowerCase().endsWith('.md') ? 'markdown' : 'text';
    setBusy(`upload:${file.name}`);
    setError('');
    try {
      const content = isPdf ? await fileToBase64(file) : await file.text();
      await api.knowledge.upload(project.id, file.name, type, content);
      toast('success', `「${file.name}」已入库`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy('query');
    setError('');
    try {
      setAnswer(await api.knowledge.query(project.id, q));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const remove = (doc: KnowledgeDoc) => {
    setDeleting(doc);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.knowledge.remove(deleting.id);
      setDeleting(null);
      setAnswer(null);
      load();
      toast('info', `「${deleting.name}」已删除`);
    } catch (e: any) {
      setError(e.message);
      setDeleting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <ErrorBox message={error} />

      {/* 上传区 */}
      <Card className="p-5 mb-4">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Upload size={16} className="text-teal-600" /> 上传研究资料
          </span>
        </SectionTitle>
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            dragging ? 'border-teal-500 bg-teal-50/80 border-dashed' : 'border-slate-300 dark:border-slate-700 hover:border-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) uploadFile(file);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = '';
            }}
          />
          <FileText size={28} className="mx-auto text-slate-400 dark:text-slate-500 mb-2" />
          <div className="text-sm text-slate-600 dark:text-slate-300">点击选择或拖拽 PDF / TXT / Markdown 到此处</div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">支持 PDF 解析与自动分块（NotebookLM 式 RAG）</div>
          {busy.startsWith('upload:') && (
            <div className="mt-2">
              <Spinner label={`解析 ${busy.slice(7)}…`} />
            </div>
          )}
        </div>

        {/* 资料概览可视化 */}
        {docs.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">文档类型分布</div>
                <Donut segments={typeDist} size={84} thickness={11} centerValue={String(docs.length)} centerLabel="份资料" />
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">分块量 Top {chunkDist.length}</div>
                <HBar items={chunkDist} barHeight={6} />
              </div>
            </div>
          </div>
        )}

        {/* 资料列表 */}
        <div className="mt-4">
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">知识库（{docs.length} 份资料）</div>
          {docs.length === 0 ? (
            <Empty text="暂无资料，上传后即可基于资料问答" />
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5">
                  <BookMarked size={15} className="text-teal-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 dark:text-slate-200 truncate">{d.name}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      <Badge tone={d.type === 'pdf' ? 'red' : d.type === 'markdown' ? 'blue' : 'slate'}>{d.type}</Badge>
                      <span className="ml-2">{d.chunkCount} 个分块</span>
                    </div>
                    {/* 文献库↔知识库打通（#5）：绑定状态 + 绑定/解除 */}
                    {d.reference ? (
                      <div className="text-[11px] text-teal-600 dark:text-teal-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        <Link2 size={11} className="shrink-0" />
                        <span className="truncate">
                          对应文献：{d.reference.title}
                          {d.reference.year ? `（${d.reference.year}${d.reference.venue ? ` / ${d.reference.venue}` : ''}）` : d.reference.venue ? `（${d.reference.venue}）` : ''}
                        </span>
                        <button onClick={() => bindRef(d, null)} className="inline-flex items-center gap-0.5 text-slate-400 hover:text-rose-500 shrink-0" title="解除绑定">
                          <Unlink size={11} /> 解除
                        </button>
                      </div>
                    ) : bindingDocId === d.id ? (
                      <div className="mt-1.5 w-full max-w-md">
                        <Input
                          autoFocus
                          placeholder="搜索文献标题 / 期刊 / 年份…"
                          value={bindQuery}
                          onChange={(e) => setBindQuery(e.target.value)}
                          className="h-8 text-[12px]"
                        />
                        {refs.length > 0 ? (
                          filteredRefs.length > 0 ? (
                            <div className="mt-1.5 max-h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                              {filteredRefs.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => bindRef(d, r.id)}
                                  className="w-full text-left px-2.5 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                                >
                                  <div className="text-[12px] text-slate-700 dark:text-slate-200 truncate">{r.title}</div>
                                  {(r.year || r.venue) && (
                                    <div className="text-[10px] text-slate-400 truncate">
                                      {[r.venue, r.year].filter(Boolean).join(' · ')}
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">未找到文献？可先在文献调研页录入</div>
                          )
                        ) : (
                          <span className="mt-1.5 block text-[11px] text-slate-400 dark:text-slate-500">本项目暂无文献，请到「文献库」录入后再绑定</span>
                        )}
                        <button onClick={() => setBindingDocId(null)} className="mt-1 text-[11px] text-slate-400 hover:text-slate-600 shrink-0">
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setBindQuery('');
                          setBindingDocId(d.id);
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-teal-500 hover:underline"
                      >
                        <Link2 size={11} /> 绑定文献
                      </button>
                    )}
                  </div>
                  <button onClick={() => remove(d)} className="text-slate-400 dark:text-slate-500 hover:text-rose-500 shrink-0" title="删除">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* RAG 问答 */}
      <Card className="p-5">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <MessageSquare size={16} className="brand-gradient-text" /> 基于资料问答
          </span>
        </SectionTitle>
        <div className="flex gap-2">
          <Input placeholder="例如：Transformer 的核心机制是什么？" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <Button onClick={ask} disabled={busy === 'query' || !question.trim()}>
            {busy === 'query' ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />} 提问
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">答案严格来自你的资料（NotebookLM 式），不依赖外部知识</div>

        {busy === 'query' && (
          <div className="mt-4">
            <Spinner label="检索资料并综合回答…" />
          </div>
        )}
        {answer && (
          <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">{answer.answer}</div>
            {answer.sources.length > 0 && (
              <div className="mt-3 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">回答依据来源（条越长匹配度越高，弱相关一眼可见）</div>
                <HBar
                  items={answer.sources.map((s) => ({
                    label: s.docName,
                    value: s.score,
                    sub: `匹配 ${s.score}%`,
                    hint: s.snippet,
                    color: s.score >= 70 ? undefined : s.score >= 40 ? '#f59e0b' : '#f87171',
                  }))}
                />
                <div className="mt-2 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                  {answer.sources.map((s, i) => {
                    const key = s.chunkId || `src-${i}`;
                    const open = !!openChunks[key];
                    const long = s.chunkText && s.chunkText.length > s.snippet.length;
                    const totalChunks = docs.find((d) => d.name === s.docName)?.chunkCount;
                    const chunkNo = typeof s.chunkSeq === 'number' ? s.chunkSeq + 1 : null;
                    return (
                      <div key={key} className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">「{s.docName}」</span>
                          {chunkNo !== null && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              分块 {chunkNo}{totalChunks ? `/${totalChunks}` : ''}
                            </span>
                          )}
                          {long && (
                            <button
                              onClick={() => toggleChunk(key)}
                              className="inline-flex items-center gap-0.5 text-teal-500 hover:underline"
                            >
                              {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              {open ? '收起原文' : '展开原文'}
                            </button>
                          )}
                        </div>
                        <div>
                          {s.snippet}
                          {!open && long ? '…' : ''}
                        </div>
                        {open && s.chunkText && (
                          <div className="mt-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                            <div className="flex items-center gap-2 border-l-[3px] border-l-teal-500 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                              <FileText size={12} className="text-teal-500 shrink-0" />
                              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                                来源：{s.docName} · 分块 {chunkNo ?? '?'}{totalChunks ? `/${totalChunks}` : ''}
                              </span>
                            </div>
                            {s.referenceTitle && (
                              <div className="px-2.5 pt-1.5 text-[11px] text-teal-600/90 dark:text-teal-400/90">📄 对应文献：{s.referenceTitle}</div>
                            )}
                            <div className="px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                              {s.chunkText}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 删除资料确认弹窗 */}
      <ConfirmDialog
        open={!!deleting}
        title="删除资料"
        description={deleting ? `确定要删除「${deleting.name}」及其全部 ${deleting.chunkCount} 个内容分块吗？删除后无法恢复。` : undefined}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
