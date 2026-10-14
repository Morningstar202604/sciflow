import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Check, ExternalLink, FilePlus2, Loader2, PlayCircle, Send, Square, Workflow } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { api, streamChat } from '../api/client';
import type { ChatSource, Doc, PipelineTask, Project } from '../types';
import { Badge, Button, Empty, Input } from '../components/ui';
import { WritingPreview } from './writing/WritingPreview';

/**
 * WorkspacePage — 对话优先工作台（对标 Codex / Qoder / GPT 形态）：
 *   左：对话线程（流式 Markdown、推理折叠、知识库来源卡）
 *   右：当前文档预览（懒加载选中文档，写作产物就地可见）
 *   顶部：文档选择 / 新建文档 / 运行流水线（产物 = 文档，直接在右侧更新）
 *
 * 设计立场（2026-10 产品重构）：主要工作 = 对话 + 预览；流水线是"一条消息里的长任务"，
 * 以 run card 形式内联在对话流中；其余 11 个工具页降级为 ⌘K 命令面板可达的次级视图。
 * 数据获取统一走 @tanstack/react-query（docs 列表 / 文档正文 / 流水线轮询）。
 */

interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  sources?: ChatSource[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  streaming?: boolean;
  stopped?: boolean;
}

const STEP_LABELS: Record<string, string> = {
  'topic-verify': '主题验证',
  literature: '文献调研',
  outline: '大纲',
  'quality-gate': '起草+质量门',
  polish: '润色',
  'citation-format': '引用',
  complete: '完成',
};

export function WorkspacePage({
  project,
  initialDocId,
  onOpenFullEditor,
}: {
  project: Project;
  initialDocId: string | null;
  onOpenFullEditor: (docId: string) => void;
}) {
  const qc = useQueryClient();
  const [docId, setDocId] = useState<string | null>(initialDocId);
  // 线程持久化（localStorage，按项目隔离）：刷新不丢对话
  const threadKey = `sciflow.workspace.thread.${project.id}`;
  const [messages, setMessages] = useState<ThreadMessage[]>(() => {
    try {
      const raw = localStorage.getItem(threadKey);
      return raw ? (JSON.parse(raw) as ThreadMessage[]).map((m) => ({ ...m, streaming: false })) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      const persistable = messages.filter((m) => !m.streaming).slice(-60);
      localStorage.setItem(threadKey, JSON.stringify(persistable));
    } catch {
      /* 隐私模式写入失败可忽略 */
    }
  }, [messages, threadKey]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [topic, setTopic] = useState('');
  const [showRun, setShowRun] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // ── 数据层（React Query）──────────────────────────────────
  const docsQuery = useQuery({ queryKey: ['docs', project.id], queryFn: () => api.documents.list(project.id) });
  // 历史会话摘要（对话历史侧栏）：来自 chat_session 落库
  const [showSessions, setShowSessions] = useState(false);
  const [sessionContext, setSessionContext] = useState<string | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ['chat-sessions', project.id],
    queryFn: () => api.chat.sessions(project.id),
    enabled: showSessions,
  });
  const docs: Doc[] = docsQuery.data ?? [];

  // 流水线轮询：仅在有活动任务时以 2.5s 间隔刷新（React Query refetchInterval）
  const taskQuery = useQuery({
    queryKey: ['pipeline-task', taskId],
    queryFn: () => api.pipeline.get(taskId!),
    enabled: !!taskId,
    refetchInterval: (q) => {
      const t = q.state.data as PipelineTask | undefined;
      if (!t) return 2500;
      return t.status === 'running' || t.status === 'awaiting_confirmation' ? 2500 : false;
    },
  });
  const task: PipelineTask | undefined = taskQuery.data;
  // 选中文档为「派生」：显式选择 > 流水线产物 > 传入初值 > 列表首个（不在 effect 里写 state）
  const effectiveDocId = docId ?? task?.documentId ?? initialDocId ?? docs[0]?.id ?? null;
  useEffect(() => {
    if (task?.documentId) {
      void qc.invalidateQueries({ queryKey: ['docs', project.id] });
      void qc.invalidateQueries({ queryKey: ['doc', task.documentId] });
    }
  }, [task?.documentId, task?.status, project.id, qc]);

  const docQuery = useQuery({
    queryKey: ['doc', effectiveDocId],
    queryFn: () => api.documents.get(effectiveDocId!),
    enabled: !!effectiveDocId,
  });
  const activeDoc: Doc | undefined = docQuery.data;

  // ── 对话 ─────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }));
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setStreaming(true);
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]);
    scrollToBottom();
    const history = messages.filter((x) => !x.streaming).map((x) => ({ role: x.role, content: x.content }));
    const updateLast = (patch: Partial<ThreadMessage> | ((m: ThreadMessage) => Partial<ThreadMessage>)) =>
      setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
    abortRef.current = streamChat({
      message: text,
      history,
      projectId: project.id,
      docContext:
        [
          activeDoc && effectiveDocId ? `当前文档《${activeDoc.title}》正文（片段）：\n${(activeDoc.content || '').slice(0, 1500)}` : '',
          sessionContext ? `历史会话背景（用户主动引用）：${sessionContext}` : '',
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
      onDelta: (d) => { updateLast((x) => ({ content: (x.content || '') + d })); scrollToBottom(); },
      onReasoning: (r) => { updateLast((x) => ({ reasoning: (x.reasoning || '') + r })); scrollToBottom(); },
      onSources: (s) => updateLast({ sources: s }),
      onUsage: (u) => updateLast({ usage: u }),
      onDone: () => { setStreaming(false); updateLast({ streaming: false }); abortRef.current = null; },
      onError: (msg) => { setStreaming(false); updateLast((x) => ({ streaming: false, content: x.content || `（出错了：${msg}）`, stopped: true })); abortRef.current = null; },
    });
  }, [input, streaming, messages, project.id, activeDoc, effectiveDocId, sessionContext, scrollToBottom]);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, streaming: false, stopped: true } : x)));
  }, []);

  // ── 流水线 ───────────────────────────────────────────────
  const runPipeline = useMutation({
    mutationFn: () => api.pipeline.create(project.id, topic.trim()),
    onSuccess: (t) => {
      setTaskId(t.id);
      setShowRun(false);
      setTopic('');
      setMessages((m) => [...m, { role: 'assistant', content: `已启动全自动流水线（主题：${t.topic}）。进度与确认操作见下方运行卡片。` }]);
      scrollToBottom();
    },
  });
  const confirmOutline = useMutation({
    mutationFn: () => api.pipeline.confirmOutline(taskId!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pipeline-task', taskId] }),
  });
  const newDoc = useMutation({
    mutationFn: () => api.documents.create(project.id, '未命名论文'),
    onSuccess: (d) => {
      setDocId(d.id);
      void qc.invalidateQueries({ queryKey: ['docs', project.id] });
    },
  });

  // 运行卡「已用时」计时（busy 时每秒刷新；interval 回调内 setState，符合 hooks 规范）
  const [nowTs, setNowTs] = useState(() => Date.now());
  const taskBusy = !!task && (task.status === 'running' || task.status === 'awaiting_confirmation');
  useEffect(() => {
    if (!taskBusy) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [taskBusy]);

  const outlinePreview = useMemo(() => {
    const step = task?.steps.find((s) => s.key === 'outline');
    if (!step?.output) return null;
    try {
      const o = JSON.parse(step.output) as { title?: string; sections?: { title: string }[] };
      return o;
    } catch {
      return null;
    }
  }, [task?.steps]);

  const busy = task && (task.status === 'running' || task.status === 'awaiting_confirmation');

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 顶栏：文档流 & 流水线入口 */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-sm bg-white dark:bg-slate-900 outline-none max-w-[280px]"
          value={effectiveDocId ?? ''}
          onChange={(e) => setDocId(e.target.value || null)}
        >
          <option value="">（未选择文档）</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => newDoc.mutate()} loading={newDoc.isPending} title="新建文档">
          <FilePlus2 size={14} /> 新建
        </Button>
        <Button variant="outline" onClick={() => setShowRun((v) => !v)} disabled={!!busy} title="运行全自动流水线">
          <Workflow size={14} /> 运行流水线
        </Button>
        <Button variant="outline" onClick={() => setShowSessions((v) => !v)} title="历史会话摘要（chat_session 落库）">
          <Brain size={14} /> 历史会话
        </Button>
        {messages.length > 0 && (
          <Button variant="ghost" onClick={() => { setMessages([]); setSessionContext(null); }} title="清空当前对话">
            清空对话
          </Button>
        )}
        {effectiveDocId && (
          <Button variant="ghost" onClick={() => onOpenFullEditor(effectiveDocId)} title="打开完整写作页（大纲/引用/导出）">
            <ExternalLink size={14} /> 完整编辑器
          </Button>
        )}
        {busy && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-teal-600 dark:text-teal-300">
            <Loader2 size={13} className="animate-spin" /> 流水线进行中：{STEP_LABELS[task.currentStep] || task.currentStep}
          </span>
        )}
      </div>

      {/* 历史会话抽屉：摘要列表 → 点击注入为对话背景 */}
      {showSessions && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shrink-0 max-h-56 overflow-y-auto">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">历史会话（点击引用其摘要作为对话背景）</div>
          {sessionsQuery.isLoading && <div className="text-xs text-slate-400">加载中…</div>}
          {!sessionsQuery.isLoading && (sessionsQuery.data?.sessions?.length ?? 0) === 0 && <div className="text-xs text-slate-400">暂无历史会话（完成一次问答后自动沉淀摘要）</div>}
          <div className="space-y-1.5">
            {(sessionsQuery.data?.sessions ?? []).map((sess) => (
              <button
                key={sess.id}
                className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  sessionContext === sess.summary
                    ? 'border-teal-400 bg-teal-50/60 dark:bg-teal-900/20 dark:border-teal-700'
                    : 'border-slate-200 dark:border-slate-700 hover:border-teal-300'
                }`}
                onClick={() => setSessionContext(sessionContext === sess.summary ? null : sess.summary)}
              >
                <div className="text-slate-700 dark:text-slate-200 line-clamp-2">{sess.summary || '（无摘要）'}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {new Date(sess.createdAt).toLocaleString()} · {sess.messageCount} 条消息 · {sess.totalTokens} tokens
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 流水线启动条（内联，不弹窗） */}
      {showRun && (
        <div className="flex items-center gap-2 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 px-3 py-2 shrink-0">
          <Input
            autoFocus
            placeholder="输入研究主题，例如：图神经网络在药物发现中的应用综述"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && topic.trim()) runPipeline.mutate(); }}
            className="flex-1"
          />
          <Button onClick={() => topic.trim() && runPipeline.mutate()} loading={runPipeline.isPending} disabled={!topic.trim()}>
            <PlayCircle size={14} /> 启动
          </Button>
        </div>
      )}

      {/* 主体：对话（左）+ 文档预览（右） */}
      <div className="flex-1 min-h-0 flex gap-3">
        <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div ref={threadRef} data-testid="chat-thread" className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.length === 0 && (
              <Empty text="开始与 SciFlow 对话" hint="让 AI 起草章节、润色、答疑；或点上方「运行流水线」一键成稿——产物会出现在右侧预览" />
            )}
            {messages.map((m, i) => (
              <div key={i}>
                {m.role === 'user' ? (
                  <div className="ml-auto max-w-[85%] w-fit rounded-2xl bg-teal-600/10 dark:bg-teal-400/10 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-full text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                    {m.reasoning ? (
                      <details className="mb-1.5">
                        <summary className="cursor-pointer select-none text-[11px] font-medium text-teal-700 dark:text-teal-300 flex items-center gap-1">
                          <Brain size={11} /> 思考过程
                        </summary>
                        <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 border-l-2 border-teal-300 dark:border-teal-700 pl-2 max-h-32 overflow-y-auto">{m.reasoning}</div>
                      </details>
                    ) : null}
                    {m.content ? <Streamdown mode={m.streaming ? 'streaming' : 'static'}>{m.content}</Streamdown> : m.streaming ? <Loader2 size={13} className="animate-spin text-teal-500" /> : null}
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.sources.slice(0, 4).map((s, k) => (
                          <span key={k} className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400" title={s.chunkText?.slice(0, 200)}>
                            📄 {s.docName} · {(s.score ?? 0).toFixed?.(0) ?? s.score}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.usage && !m.streaming && (
                      <div className="mt-1 text-[10px] text-slate-400">↑{m.usage.prompt_tokens} ↓{m.usage.completion_tokens}</div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* 流水线运行卡（内联在对话流） */}
            {task && (
              <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 shadow-sm p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-700 dark:text-teal-300 mb-2">
                  <Workflow size={13} /> 流水线 · {task.topic}
                  <span className="ml-auto font-normal text-slate-400">
                    {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : '进行中'}
                    {taskBusy && task.createdAt ? ` · ${Math.max(0, Math.floor((nowTs - task.createdAt) / 1000))}s` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {task.steps.map((s) => (
                    <span
                      key={s.key}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${
                        s.status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : s.status === 'failed' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                        : s.status === 'running' || s.status === 'scored' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                        : s.status === 'awaiting_confirmation' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {s.status === 'done' && <Check size={9} />}
                      {(s.status === 'running' || s.status === 'scored') && <Loader2 size={9} className="animate-spin" />}
                      {STEP_LABELS[s.key] || s.label}
                    </span>
                  ))}
                </div>
                {task.status === 'awaiting_confirmation' && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 mb-2">
                    <div className="text-[11px] text-amber-800 dark:text-amber-300 mb-1.5">大纲已生成，确认后开始起草：</div>
                    {outlinePreview ? (
                      <ol className="text-xs text-slate-700 dark:text-slate-200 list-decimal ml-4 space-y-0.5 mb-2">
                        <li className="font-medium list-none -ml-4 mb-1">{outlinePreview.title}</li>
                        {(outlinePreview.sections || []).map((s, k) => (
                          <li key={k}>{s.title}</li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="flex gap-2">
                      <Button className="text-xs px-3 py-1.5" onClick={() => confirmOutline.mutate()} loading={confirmOutline.isPending}>
                        <Check size={12} /> 确认并开始起草
                      </Button>
                      <a className="text-xs self-center text-slate-400 hover:text-slate-600" href={`#/pipeline`}>
                        去高级页编辑大纲 →
                      </a>
                    </div>
                  </div>
                )}
                {task.status === 'completed' && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="green">
                      {task.steps.find((s) => s.key === 'quality-gate')?.output?.match(/总分\s*\d+/)?.[0] || '完成'}
                    </Badge>
                    {task.documentId && (
                      <button className="text-teal-600 dark:text-teal-300 hover:underline" onClick={() => setDocId(task.documentId!)}>
                        查看成稿 →
                      </button>
                    )}
                  </div>
                )}
                {task.status === 'failed' && <div className="text-xs text-rose-500">{task.lastError || '执行失败'}</div>}
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-slate-100 dark:border-slate-800 p-2.5 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
                placeholder="问问题 / 让 AI 起草内容（⌘+Enter 发送）…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              />
              {streaming ? (
                <Button variant="danger" onClick={stop} title="停止生成">
                  <Square size={14} /> 停止
                </Button>
              ) : (
                <Button onClick={send} disabled={!input.trim()} title="发送">
                  <Send size={14} /> 发送
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 右侧文档预览 */}
        <div className="hidden lg:flex w-[46%] min-w-[320px] max-w-[640px] flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{activeDoc?.title || '文档预览'}</span>
            {activeDoc && <Badge tone="blue">v{activeDoc.version}</Badge>}
            {effectiveDocId && (
              <button className="ml-auto text-[11px] text-slate-400 hover:text-teal-600" onClick={() => onOpenFullEditor(effectiveDocId)}>
                编辑 →
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeDoc ? (
              <WritingPreview content={activeDoc.content || ''} editorMode="preview" exported={[]} />
            ) : (
              <Empty text="暂无文档" hint="在下方对话让 AI 起草，或运行流水线自动成稿" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
