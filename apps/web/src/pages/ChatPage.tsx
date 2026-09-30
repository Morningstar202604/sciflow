import { useContext, useEffect, useRef, useState } from 'react';
import {
  Brain, Check, Copy, Download, FileText, Loader2, MessageSquare, Navigation, Pencil, PlayCircle, Quote, RotateCcw, Send, Sparkles, Square, X,
} from 'lucide-react';
import { api, streamChat } from '../api/client';
import { ToastContext } from '../App';
import type { Doc, IntentResult, KnowledgeDoc, Project } from '../types';
import { Card, ErrorBox, Modal } from '../components/ui';

/** 消息结构（含主流智能体范式的附加字段：思考流/来源/用量/follow-up/状态） */
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  stopped?: boolean;
  reasoning?: string;
  sources?: { docName: string; score: number }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  followUps?: string[];
  error?: string;
}

/** Slash 命令：可复用的 prompt 模板（科研高频动作） */
const SLASH_COMMANDS: { name: string; desc: string; template: string }[] = [
  { name: '润色', desc: '提升学术表达质量', template: '请润色以下内容，提升学术表达质量，保持原意：\n\n{{input}}' },
  { name: '翻译英文', desc: '翻译为地道学术英文', template: '请将以下内容翻译为地道的学术英文：\n\n{{input}}' },
  { name: '翻译中文', desc: '翻译为流畅中文', template: '请将以下内容翻译为流畅的中文：\n\n{{input}}' },
  { name: '生成摘要', desc: '提取要点与关键词', template: '请为以下内容生成摘要（3-5 句话）与关键词列表：\n\n{{input}}' },
  { name: '生成大纲', desc: '围绕主题生成论文大纲', template: '请围绕以下主题生成一份论文大纲（章节+要点）：\n\n{{input}}' },
  { name: '降重', desc: '改写降低重复率', template: '请改写以下内容以降低与原文的重复率，保持原意与学术性：\n\n{{input}}' },
  { name: '补充引用', desc: '建议可引用文献与研究', template: '请针对以下内容，建议可引用的相关文献与研究并说明理由：\n\n{{input}}' },
  { name: '深入追问', desc: '就内容继续深挖', template: '请就以下内容进一步深入分析，给出更细致的论证：\n\n{{input}}' },
];

/** 请求附带的隐藏指令：让模型在末尾输出 follow-up 建议（缺失时解析器兼容） */
const FOLLOWUP_HINT = '\n\n（若方便，请在回答末尾用单独一行 "---FOLLOWUPS---" 开头，随后给出 2-3 个简短的后续追问建议，每行一个。）';

/** 解析 follow-up 标记：正文与建议分离 */
function parseFollowUps(full: string): { content: string; followUps: string[] } {
  const idx = full.indexOf('---FOLLOWUPS---');
  if (idx === -1) return { content: full, followUps: [] };
  const content = full.slice(0, idx).trimEnd();
  const followUps = full
    .slice(idx + '---FOLLOWUPS---'.length)
    .trim()
    .split('\n')
    .map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return { content, followUps };
}

/** 数值千分位 / 缩写（12345 → "12.3k"） */
const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('zh-CN'));

export function ChatPage({ project }: { project: Project }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      content: `你好！我是 SciFlow 科研助手，正在协助你的项目「${project.name}」。我可以回答论文写作、研究方法、数据分析、投稿策略等问题。输入 "/" 可唤起快捷指令，⌘/Ctrl+Enter 发送，Esc 停止生成。`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [intentBusy, setIntentBusy] = useState(false);
  const [docs, setDocs] = useState<{ id: string; title: string; content?: string; outline?: string }[]>([]);
  const [linkedDocId, setLinkedDocId] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const toast = useContext(ToastContext);
  // RAG 一键引用：知识库文档名→referenceId 映射（SSE 来源只带 docName/score，按名反查绑定文献）
  const [kbByName, setKbByName] = useState<Map<string, KnowledgeDoc>>(new Map());
  // 引用目标选择弹层 + 已引用标记
  const [citeSource, setCiteSource] = useState<{ docName: string; score: number } | null>(null);
  const [citing, setCiting] = useState(false);
  const [citedKeys, setCitedKeys] = useState<Record<string, boolean>>({});

  const hasConversation = messages.some((m) => m.role === 'user');

  // 加载项目文档列表（关联上下文用）+ 模型列表（模型选择器）+ 知识库文档名→绑定文献映射（来源卡引用）
  useEffect(() => {
    api.documents
      .list(project.id)
      .then((list) => setDocs(list))
      .catch(() => undefined);
    api.settings
      .get()
      .then((s) => setModels(s.ai.models || []))
      .catch(() => undefined);
    api.knowledge
      .list(project.id)
      .then((list) => setKbByName(new Map(list.map((d) => [d.name, d]))))
      .catch(() => undefined);
  }, [project.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** 组装当前文档上下文（标题+大纲+正文前 1600 字） */
  const docContextFor = (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return '';
    const outline = (() => {
      try {
        const o = JSON.parse(doc.outline || '[]');
        return Array.isArray(o.sections) ? o.sections.map((s: any) => s.title).join(' / ') : '';
      } catch {
        return '';
      }
    })();
    return `标题：${doc.title}\n大纲：${outline || '（未设置）'}\n正文摘要：${(doc.content || '').replace(/[#*`>]/g, '').slice(0, 1600)}`;
  };

  const updateLast = (fn: (m: Msg) => Msg) =>
    setMessages((s) => {
      const next = [...s];
      const last = next[next.length - 1];
      if (last?.streaming) next[next.length - 1] = fn(last);
      return next;
    });

  /** 核心发送：以指定历史发起一轮问答（history 为当前消息快照，text 为用户文本） */
  const doSend = (text: string, history: Msg[]) => {
    setError('');
    setMessages((s) => [...s, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]);
    setBusy(true);

    // 意图识别（规则优先毫秒级，LLM 兜底）——与对话并行，不阻塞
    setIntentBusy(true);
    setIntent(null);
    api.judgment
      .intent(text, project.name)
      .then((r) => setIntent(r))
      .catch(() => undefined)
      .finally(() => setIntentBusy(false));

    const requestText = `${text}${FOLLOWUP_HINT}`;
    stopRef.current = streamChat({
      message: requestText,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      projectId: project.id,
      docContext: linkedDocId ? docContextFor(linkedDocId) : undefined,
      model: model || undefined,
      enableThinking: thinking || undefined,
      onDelta: (fullText) => updateLast((m) => ({ ...m, content: fullText })),
      onReasoning: (r) => updateLast((m) => ({ ...m, reasoning: r })),
      onSources: (src) => updateLast((m) => ({ ...m, sources: src })),
      onUsage: (u) => updateLast((m) => ({ ...m, usage: u })),
      onDone: (fullText) => {
        const { content, followUps } = parseFollowUps(fullText);
        setMessages((s) => s.map((m) => (m.streaming ? { ...m, streaming: false, stopped: false, content, followUps } : m)));
        setBusy(false);
        stopRef.current = null;
      },
      onError: (msg) => {
        setMessages((s) =>
          s.map((m) =>
            m.streaming ? { ...m, streaming: false, stopped: true, content: m.content || '（回答失败）', error: msg } : m,
          ),
        );
        setError(msg);
        setBusy(false);
        stopRef.current = null;
      },
    });
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setSlashOpen(false);
    doSend(text, messages);
  };

  const stop = () => {
    stopRef.current?.();
  };

  /** 重试：丢弃该轮 assistant 气泡，用同一问题重新生成 */
  const retry = (i: number) => {
    const j = i - 1;
    if (j < 0 || busy) return;
    const text = messages[j].content;
    const history = messages.slice(0, j);
    setMessages((s) => s.slice(0, j));
    doSend(text, history);
  };

  /** 继续：保留已生成部分，从断点续写 */
  const cont = (i: number) => {
    if (busy) return;
    const history = messages.slice(0, i);
    doSend('请从断点继续，完成上一条回答的剩余部分。', history);
  };

  /** 编辑用户消息：截断到该消息之前，文本回填输入框重发 */
  const editMsg = (j: number) => {
    if (busy) return;
    setMessages((s) => s.slice(0, j));
    setInput(messages[j].content);
    setSlashOpen(false);
    inputRef.current?.focus();
  };

  /** 发送到写作页：以回答内容新建草稿并跳转 */
  const sendToWriting = async (i: number) => {
    try {
      const firstLine = messages[i].content.split('\n').find((l) => l.trim())?.trim() || '';
      const title = `${firstLine.slice(0, 20) || '聊天摘录'}（聊天摘录）`;
      const doc = await api.documents.create(project.id, title);
      await api.documents.update(doc.id, { content: messages[i].content });
      window.location.hash = `/writing?doc=${doc.id}`;
    } catch {
      setError('发送到写作页失败，请稍后重试');
    }
  };

  const copyMsg = async (i: number) => {
    try {
      await navigator.clipboard.writeText(messages[i].content);
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  };

  /** RAG 一键引用：打开目标文档选择弹层（docName 已在 kbByName 中查到 referenceId） */
  const openCite = (s: { docName: string; score: number }) => {
    if (!kbByName.get(s.docName)?.referenceId) return; // 未绑定文献：按钮已禁用
    setCiteSource(s);
  };

  /** 选定目标文档 → 幂等写入引用（location 标记为 RAG 来源） */
  const doCite = async (docId: string) => {
    if (!citeSource) return;
    const refId = kbByName.get(citeSource.docName)?.referenceId;
    if (!refId) return;
    setCiting(true);
    try {
      await api.references.addCitation({
        documentId: docId,
        referenceId: refId,
        location: 'rag:' + citeSource.docName,
        context: '',
      });
      setCitedKeys((m) => ({ ...m, [citeSource.docName]: true }));
      toast('success', `已引用「${citeSource.docName}」到论文`);
      setCiteSource(null);
    } catch (e: any) {
      setError(e?.message || '引用失败');
    } finally {
      setCiting(false);
    }
  };

  /** 任务7：把当前会话（用户/助手文本 + 各消息来源）序列化为自包含 Markdown 并前端 Blob 下载 */
  const exportSnapshot = () => {
    const lines: string[] = [];
    lines.push(`# 科研问答快照 · ${project.name}`);
    lines.push('');
    lines.push(`导出时间：${new Date().toLocaleString('zh-CN')} ｜ 共 ${messages.filter((m) => m.role === 'user').length} 轮提问`);
    lines.push('');
    for (const m of messages) {
      if (m.role === 'user') {
        lines.push('## 👤 提问');
        lines.push('');
        lines.push(m.content);
        lines.push('');
      } else {
        lines.push('## 🤖 回答');
        lines.push('');
        if (m.reasoning) lines.push(`> **思考过程**：${m.reasoning.slice(0, 600)}`);
        lines.push(m.content || '（空）');
        lines.push('');
        if (m.sources && m.sources.length > 0) {
          lines.push('**参考来源：**');
          for (const s of m.sources) {
            const pct = Math.round(s.score > 1 ? s.score : s.score * 100);
            lines.push(`- ${s.docName}（相关度 ${pct}%）`);
          }
          lines.push('');
        }
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `科研问答快照-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('success', '已导出 Markdown 会话快照');
  };

  // Slash 命令下拉
  const slashFiltered = input.startsWith('/') ? SLASH_COMMANDS.filter((c) => c.name.includes(input.slice(1))).slice(0, 5) : [];

  const applySlash = (c: (typeof SLASH_COMMANDS)[number]) => {
    setInput(c.template.replace('{{input}}', ''));
    setSlashOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="max-w-3xl mx-auto h-full flex flex-col">
      <Card className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 shrink-0 flex-wrap">
          <MessageSquare size={15} className="brand-gradient-text" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">科研问答</span>
          <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:inline">流式 · 可停止重试 · 思考可见 · 上下文感知</span>
          <div className="ml-auto flex items-center gap-1.5 min-w-0 flex-wrap">
            {/* 导出会话快照（任务7）：无实际问答时禁用 */}
            <button
              onClick={exportSnapshot}
              disabled={!hasConversation}
              className="flex items-center gap-1 text-xs rounded-md px-1.5 py-1 border text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-teal-600 hover:border-teal-400 disabled:opacity-40 disabled:cursor-not-allowed"
              title="把当前会话（问答 + 来源）导出为只读 Markdown"
            >
              <Download size={12} /> <span className="hidden sm:inline">导出快照</span>
            </button>
            {/* 模型选择器（主流范式：切换模型） */}
            {models.length > 0 && (
              <select
                className="text-xs bg-transparent text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-1 max-w-[140px] outline-none focus:ring-1 focus:ring-teal-500"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                title="切换本次问答使用的模型"
              >
                <option value="">默认模型</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
            {/* 深度思考开关（映射 enableThinking，厂商不支持时后端静默忽略） */}
            <button
              onClick={() => setThinking((v) => !v)}
              className={`flex items-center gap-1 text-xs rounded-md px-1.5 py-1 border transition-colors ${
                thinking
                  ? 'bg-teal-50 dark:bg-teal-500/10 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:text-slate-600'
              }`}
              title="深度思考：开启后模型先输出推理过程（支持的模型）"
            >
              <Brain size={12} /> 深度思考
            </button>
            <FileText size={13} className="text-slate-400 shrink-0 hidden sm:block" />
            <select
              className="text-xs bg-transparent text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-1 max-w-[180px] outline-none focus:ring-1 focus:ring-teal-500"
              value={linkedDocId}
              onChange={(e) => setLinkedDocId(e.target.value)}
              title="关联论文：问答将结合这篇论文的大纲与正文作答"
            >
              <option value="">关联论文（可选）</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
          </div>
        </div>

        <ErrorBox message={error} />

        {(intent || intentBusy) && (
          <div className="px-4 pt-3 shrink-0">
            <div className="flex items-center gap-2 text-xs bg-teal-50/60 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl px-3 py-2 page-in">
              {intentBusy ? (
                <>
                  <Loader2 size={13} className="animate-spin text-teal-600" />
                  <span className="text-slate-500 dark:text-slate-400">正在识别意图…</span>
                </>
              ) : intent ? (
                <>
                  <Sparkles size={13} className="text-teal-600 shrink-0" />
                  <span className="text-slate-600 dark:text-slate-300">
                    识别意图：<b className="text-teal-700 dark:text-teal-300">{intent.label}</b>
                    <span className="text-slate-400 dark:text-slate-500">（置信 {Math.round(intent.confidence * 100)}% · {intent.matchedBy === 'rule' ? '规则秒判' : 'AI 判别'}{intent.topic ? ` · 主题：${intent.topic}` : ''}）</span>
                  </span>
                  <button
                    className="ml-auto flex items-center gap-1 shrink-0 text-teal-700 dark:text-teal-300 hover:underline"
                    onClick={() => {
                      window.location.hash = intent.route;
                    }}
                  >
                    <Navigation size={12} /> 前往{intent.route === '/literature' ? '文献调研' : intent.route === '/writing' ? '论文写作' : intent.route === '/pipeline' ? '全自动流水线' : intent.route === '/quality' ? '质量评分' : '科研问答'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end group page-in">
                <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-teal-600 text-white rounded-br-sm">
                  {m.content}
                </div>
                {/* 编辑上一条用户消息（主流范式：编辑分叉重发） */}
                <button
                  onClick={() => editMsg(i)}
                  className="self-center ml-1.5 p-1 rounded-md text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 hover:text-teal-600 transition-opacity"
                  title="编辑并重新发送"
                >
                  <Pencil size={13} />
                </button>
              </div>
            ) : (
              <div key={i} className="flex justify-start group page-in">
                <div className="max-w-[85%] min-w-0">
                  <div className="rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {/* 思维链展示：折叠式思考块（默认展开流式过程，可手动收起） */}
                    {m.reasoning ? (
                      <details open={m.streaming} className="mb-2">
                        <summary className="cursor-pointer select-none text-[11px] font-medium text-teal-700 dark:text-teal-300 flex items-center gap-1 list-none marker:hidden">
                          <Brain size={12} /> 思考过程{m.streaming ? '（进行中）' : ` · ${m.reasoning.length} 字`}
                        </summary>
                        <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 border-l-2 border-teal-300 dark:border-teal-700 pl-2.5 leading-relaxed max-h-40 overflow-y-auto">
                          {m.reasoning}
                        </div>
                      </details>
                    ) : null}
                    {m.content}
                    {m.streaming && <span className="inline-block w-1.5 h-4 bg-current opacity-60 ml-0.5 align-middle pulse-dot" />}
                  </div>
                  {/* 来源引用 chips（知识库 RAG 命中）：每张可一键引用到论文 */}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.sources.map((s, si) => {
                        const refId = kbByName.get(s.docName)?.referenceId;
                        const cited = !!citedKeys[s.docName];
                        const pct = Math.round(s.score > 1 ? s.score : s.score * 100);
                        return (
                          <span
                            key={si}
                            className="inline-flex items-center gap-1 text-[11px] bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 rounded-full px-2 py-0.5 border border-teal-200 dark:border-teal-800"
                          >
                            <FileText size={10} /> {s.docName} · {pct}%
                            {cited ? (
                              <span className="inline-flex items-center gap-0.5 text-teal-700 dark:text-teal-300"><Check size={10} />已引用</span>
                            ) : (
                              <button
                                onClick={() => openCite(s)}
                                disabled={!refId}
                                title={refId ? '把该来源引用进论文草稿' : '先在知识库把这份资料绑定到文献，再引用'}
                                className="ml-0.5 inline-flex items-center gap-0.5 underline underline-offset-2 disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
                              >
                                <Quote size={10} />引用
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* 用量小字 */}
                  {m.usage && !m.streaming && (
                    <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                      ↑{fmtNum(m.usage.prompt_tokens)} ↓{fmtNum(m.usage.completion_tokens)} tokens
                    </div>
                  )}
                  {/* follow-up 建议（主流范式：点击即追问） */}
                  {m.followUps && m.followUps.length > 0 && !m.streaming && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.followUps.map((f, fi) => (
                        <button
                          key={fi}
                          onClick={() => {
                            setMessages((s) => s.slice(0, i + 1));
                            doSend(f, messages.slice(0, i + 1));
                          }}
                          className="text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded-full px-2.5 py-1 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-300 transition-colors text-left"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* 消息操作条：重试 / 继续 / 复制 / 发送到写作页 */}
                  {!m.streaming && (
                    <div className="mt-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {m.stopped && (
                        <button onClick={() => cont(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600 dark:hover:text-teal-300" title="继续生成">
                          <PlayCircle size={13} />
                        </button>
                      )}
                      <button onClick={() => retry(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600 dark:hover:text-teal-300" title="重新生成">
                        <RotateCcw size={13} />
                      </button>
                      <button onClick={() => copyMsg(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600 dark:hover:text-teal-300" title="复制回答">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => sendToWriting(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600 dark:hover:text-teal-300" title="发送到写作页（新建草稿并打开）">
                        <FileText size={13} />
                      </button>
                      {m.error && <span className="text-[10px] text-rose-500 ml-1">{m.error}</span>}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-slate-100 dark:border-slate-800 shrink-0 relative">
          {/* Slash 命令下拉 */}
          {slashOpen && slashFiltered.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden page-in z-10">
              {slashFiltered.map((c) => (
                <button
                  key={c.name}
                  onClick={() => applySlash(c)}
                  className="w-full text-left px-3 py-2 hover:bg-teal-50 dark:hover:bg-teal-500/10 flex items-center gap-2"
                >
                  <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 w-14 shrink-0">/{c.name}</span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-teal-500 bg-white dark:bg-slate-900"
              placeholder={'问任何科研问题…（输入 "/" 唤出快捷指令）'}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSlashOpen(e.target.value.startsWith('/'));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (slashOpen && slashFiltered.length > 0) {
                    applySlash(slashFiltered[0]);
                  } else {
                    send();
                  }
                } else if (e.key === 'Escape') {
                  if (busy) stop();
                  setSlashOpen(false);
                } else if (e.key === 'ArrowUp' && !(e.target as HTMLInputElement).value) {
                  // 空输入框 ↑：编辑上一条用户消息
                  const lastUser = [...messages].reverse().findIndex((m) => m.role === 'user');
                  if (lastUser !== -1) editMsg(messages.length - 1 - lastUser);
                }
              }}
              disabled={busy}
            />
            {busy ? (
              <button
                onClick={stop}
                className="rounded-xl bg-rose-500 text-white px-4 flex items-center gap-1.5 hover:bg-rose-600 text-sm shrink-0"
                title="停止生成（Esc）"
              >
                <Square size={14} /> 停止
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="rounded-xl bg-teal-600 text-white px-4 flex items-center gap-1.5 hover:bg-teal-700 disabled:opacity-50 text-sm shrink-0"
                title="发送（⌘/Ctrl+Enter）"
              >
                <Send size={15} />
                发送
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400 dark:text-slate-500 overflow-x-auto whitespace-nowrap">
            <span>⌘/Ctrl+Enter 发送</span>
            <span className="text-slate-200 dark:text-slate-700">·</span>
            <span>Esc 停止</span>
            <span className="text-slate-200 dark:text-slate-700">·</span>
            <span>↑ 编辑上一条</span>
            <span className="text-slate-200 dark:text-slate-700">·</span>
            <span>"/" 快捷指令</span>
            {thinking && <span className="ml-auto flex items-center gap-1 text-teal-600 dark:text-teal-400"><Check size={10} /> 深度思考已开启</span>}
          </div>
        </div>
      </Card>

      {/* RAG 一键引用：选择目标论文草稿 */}
      <Modal open={!!citeSource} onClose={() => !citing && setCiteSource(null)} title="引用到论文">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          把来源「{citeSource?.docName}」引用进哪篇论文草稿？
        </div>
        {docs.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">本项目暂无论文草稿，请到「论文写作」新建一篇</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {docs.map((d) => (
              <button
                key={d.id}
                disabled={citing}
                onClick={() => doCite(d.id)}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 flex items-center gap-2"
              >
                <FileText size={13} className="text-teal-500 shrink-0" />
                <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{d.title}</span>
                {citing && citeSource?.docName && <Loader2 size={13} className="animate-spin ml-auto" />}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
