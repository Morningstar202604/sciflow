import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, Check, ChevronDown, ChevronUp, Copy, Download, FileText, Globe, Loader2, MessageSquare, Navigation, Pencil,
  PlayCircle, Plus, Quote, RotateCcw, Search, Send, Sparkles, Square, Trash2,
} from 'lucide-react';
import { Streamdown } from 'streamdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { api, streamChat } from '../api/client';
import { ToastContext } from '../App';
import type { ChatSource, IntentResult, KnowledgeDoc, Project } from '../types';
import { Card, ErrorBox, Modal, errMsg } from '../components/ui';
import {
  createSession, deriveTitle, loadActiveSessionId, loadDraft, loadSessions, saveActiveSessionId, saveDraft, saveSessions,
  type ChatSession, type StoredMessage,
} from './chat/chat-sessions';

/** 消息结构（含主流智能体范式的附加字段：思考流/来源/用量/follow-up/状态） */
interface Msg extends StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

const SLASH_COMMANDS: { name: string; desc: string; template: string }[] = [
  { name: '润色', desc: '提升学术表达质量', template: '请润色以下内容，提升学术表达质量，保持原意：\n\n' },
  { name: '翻译英文', desc: '翻译为地道学术英文', template: '请将以下内容翻译为地道的学术英文：\n\n' },
  { name: '翻译中文', desc: '翻译为流畅的中文', template: '请将以下内容翻译为流畅的中文：\n\n' },
  { name: '生成摘要', desc: '提取要点与关键词', template: '请为以下内容生成摘要（3-5 句话）与关键词列表：\n\n' },
  { name: '生成大纲', desc: '围绕主题生成论文大纲', template: '请围绕以下主题生成一份论文大纲（章节+要点）：\n\n' },
  { name: '降重', desc: '改写降低重复率', template: '请改写以下内容以降低与原文的重复率，保持原意与学术性：\n\n' },
  { name: '补充引用', desc: '建议可引用文献与研究', template: '请针对以下内容，建议可引用的相关文献与研究并说明理由：\n\n' },
  { name: '深入追问', desc: '就内容继续深挖', template: '请就以下内容进一步深入分析，给出更细致的论证：\n\n' },
];

const FOLLOWUP_HINT = '\n\n（若方便，请在回答末尾用单独一行 "---FOLLOWUPS---" 开头，随后给出 2-3 个简短的后续追问建议，每行一个。）';

function parseFollowUps(full: string): { content: string; followUps: string[] } {
  const idx = full.indexOf('---FOLLOWUPS---');
  if (idx === -1) return { content: full, followUps: [] };
  return {
    content: full.slice(0, idx).trimEnd(),
    followUps: full
      .slice(idx + '---FOLLOWUPS---'.length)
      .trim()
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('zh-CN'));
const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '');

const greeting = (name: string): Msg => ({
  role: 'assistant',
  content: `你好！我是 SciFlow 科研助手，正在协助你的项目「${name}」。可以回答论文写作、研究方法、数据分析、投稿策略等问题。输入 “/” 唤起快捷指令，Enter 发送、Shift+Enter 换行，Esc 随时停止生成。`,
  createdAt: Date.now(),
});

export function ChatPage({ project }: { project: Project }) {
  const toast = useContext(ToastContext);

  /* ── 会话（按项目隔离，localStorage 持久化） ───────────────── */
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions(project.id));
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadActiveSessionId(project.id);
    const list = loadSessions(project.id);
    return saved && list.some((s) => s.id === saved) ? saved : (list[0]?.id ?? createSession().id);
  });
  const [busy, setBusy] = useState(false);
  /** 流式中止句柄：供 Esc / 停止按钮 / 切会话时统一中断（必须在任何 effect 之前声明） */
  const stopRef = useRef<(() => void) | null>(null);
  const [messages, setMessages] = useState<Msg[]>(() => {
    const saved = loadActiveSessionId(project.id);
    const list = loadSessions(project.id);
    const target = saved ? list.find((s) => s.id === saved) : list[0];
    return target && target.messages.length ? (target.messages as Msg[]) : [greeting(project.name)];
  });

  const [input, setInput] = useState(() => loadDraft(project.id, activeId));
  const [error, setError] = useState('');
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [intentBusy, setIntentBusy] = useState(false);
  const [docs, setDocs] = useState<{ id: string; title: string; content?: string; outline?: string }[]>([]);
  const [linkedDocId, setLinkedDocId] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);
  const [sessionFilter, setSessionFilter] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [kbByName, setKbByName] = useState<Map<string, KnowledgeDoc>>(new Map());
  const [citeSource, setCiteSource] = useState<ChatSource | null>(null);
  const [citing, setCiting] = useState(false);
  const [citedKeys, setCitedKeys] = useState<Record<string, boolean>>({});
  const [openSrc, setOpenSrc] = useState<Record<string, boolean>>({});

  /* 项目切换：整体重置会话状态，杜绝跨项目串话与错误项目写入（历史缺陷） */
  useEffect(() => {
    const list = loadSessions(project.id);
    const saved = loadActiveSessionId(project.id);
    const target = saved ? list.find((s) => s.id === saved) : list[0];
    setSessions(list);
    setActiveId(target?.id ?? createSession().id);
    setMessages(target && target.messages.length ? (target.messages as Msg[]) : [greeting(project.name)]);
    setInput('');
    setBusy(false);
    stopRef.current?.();
    stopRef.current = null;
  }, [project.id, project.name]);

  /* 会话消息变动即落盘（流式中的临时态不持久化） */
  useEffect(() => {
    if (busy) return;
    const clean = messages.filter((m) => !m.streaming);
    if (!clean.some((m) => m.role === 'user')) return;
    setSessions((prev) => {
      const now = Date.now();
      const base = prev.filter((s) => s.id !== activeId);
      const current: ChatSession = {
        id: activeId,
        title: deriveTitle(clean),
        createdAt: prev.find((s) => s.id === activeId)?.createdAt ?? now,
        updatedAt: now,
        messages: clean.map(({ streaming: _s, ...rest }) => rest),
      };
      const next = [current, ...base];
      saveSessions(project.id, next);
      return next;
    });
    saveActiveSessionId(project.id, activeId);
  }, [messages, busy, activeId, project.id]);

  const hasConversation = messages.some((m) => m.role === 'user');

  /* 草稿自动保存（300ms 防抖；切页/刷新后恢复） */
  useEffect(() => {
    const t = setTimeout(() => saveDraft(project.id, activeId, input), 300);
    return () => clearTimeout(t);
  }, [input, project.id, activeId]);

  useEffect(() => {
    api.documents.list(project.id).then(setDocs).catch(() => undefined);
    api.settings.get().then((s) => setModels(s.ai.models || [])).catch(() => undefined);
    api.knowledge.list(project.id).then((list) => setKbByName(new Map(list.map((d) => [d.name, d])))).catch(() => undefined);
  }, [project.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* Esc 全局停止（此前监听挂在生成中被 disabled 的输入框上，实际无效） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stopRef.current) {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const docContextFor = (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return '';
    return `标题：${doc.title}\n正文摘要：${(doc.content || '').replace(/[#*`>]/g, '').slice(0, 1600)}`;
  };

  const updateLast = (fn: (m: Msg) => Msg) =>
    setMessages((s) => {
      const next = [...s];
      const last = next[next.length - 1];
      if (last?.streaming) next[next.length - 1] = fn(last);
      return next;
    });

  const doSend = (text: string, history: Msg[]) => {
    setError('');
    setMessages((s) => [...s, { role: 'user', content: text, createdAt: Date.now() }, { role: 'assistant', content: '', streaming: true, createdAt: Date.now(), model }]);
    setBusy(true);
    setIntentBusy(true);
    setIntent(null);
    api.judgment.intent(text, project.name).then(setIntent).catch(() => undefined).finally(() => setIntentBusy(false));

    stopRef.current = streamChat({
      message: `${text}${FOLLOWUP_HINT}`,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      projectId: project.id,
      docContext: linkedDocId ? docContextFor(linkedDocId) : undefined,
      model: model || undefined,
      enableThinking: thinking || undefined,
      webSearch: webSearch || undefined,
      onDelta: (fullText) => updateLast((m) => ({ ...m, content: fullText })),
      onReasoning: (r) => updateLast((m) => ({ ...m, reasoning: r })),
      onSources: (src) => updateLast((m) => ({ ...m, sources: src })),
      onUsage: (u) => updateLast((m) => ({ ...m, usage: u })),
      onDone: (fullText) => {
        const { content, followUps } = parseFollowUps(fullText);
        setMessages((s) => s.map((m) => (m.streaming ? { ...m, streaming: false, content, followUps } : m)));
        setBusy(false);
        stopRef.current = null;
      },
      onError: (msg) => {
        setMessages((s) => s.map((m) => (m.streaming ? { ...m, streaming: false, stopped: true, content: m.content || '（回答失败）', error: msg } : m)));
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
    saveDraft(project.id, activeId, '');
    setSlashOpen(false);
    doSend(text, messages);
  };

  /** 停止：保留已收到的文本，标记 stopped 并提供「继续生成」（此前 abort 后气泡为空、stopped 永不置真） */
  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setBusy(false);
    setMessages((s) => s.map((m) => (m.streaming ? { ...m, streaming: false, stopped: true } : m)));
  };

  const retry = (i: number) => {
    const j = i - 1;
    if (j < 0 || busy) return;
    const text = messages[j].content;
    const history = messages.slice(0, j).filter((m) => !m.streaming);
    setMessages((s) => s.slice(0, j));
    doSend(text, history);
  };

  const cont = (i: number) => {
    if (busy) return;
    doSend('请从断点继续，完成上一条回答的剩余部分。', messages.slice(0, i));
  };

  const editMsg = (j: number) => {
    if (busy) return;
    setInput(messages[j].content);
    taRef.current?.focus();
    toast('info', '已载入原消息，编辑后按 Enter 重新发送（原对话在上方保留）');
  };

  /** 删除单条消息（含其后的问答对被单独保留为独立消息，不做隐式截断） */
  const deleteMsg = (i: number) => {
    setMessages((s) => s.filter((_, k) => k !== i));
    toast('info', '消息已删除');
  };

  const sendToWriting = async (i: number) => {
    try {
      const firstLine = messages[i].content.split('\n').find((l) => l.trim())?.trim() || '';
      const doc = await api.documents.create(project.id, `${firstLine.slice(0, 20) || '聊天摘录'}（聊天摘录）`);
      await api.documents.update(doc.id, { content: messages[i].content });
      toast('success', '已新建草稿并跳转写作页');
      window.location.hash = `/writing?doc=${doc.id}`;
    } catch {
      setError('发送到写作页失败，请稍后重试');
    }
  };

  const copyMsg = async (i: number) => {
    try {
      await navigator.clipboard.writeText(messages[i].content);
      setCopiedIdx(i);
      window.setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
    } catch {
      toast('error', '浏览器拒绝了剪贴板访问，请手动选择文本复制');
    }
  };

  const openCite = (s: ChatSource) => {
    if (!kbByName.get(s.docName)?.referenceId) return;
    setCiteSource(s);
  };

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
        context: (citeSource.chunkText || '').slice(0, 200),
      });
      setCitedKeys((m) => ({ ...m, [citeSource.docName]: true }));
      toast('success', `已引用「${citeSource.docName}」到论文`);
      setCiteSource(null);
    } catch (e: unknown) {
      setError(errMsg(e) || '引用失败');
    } finally {
      setCiting(false);
    }
  };

  const exportSnapshot = () => {
    const lines = [`# 科研问答快照 · ${project.name}`, '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    for (const m of messages) {
      if (m.role === 'user') {
        lines.push('## 提问', '', m.content, '');
      } else {
        lines.push('## 回答', '');
        if (m.reasoning) lines.push(`> 思考过程：${m.reasoning.slice(0, 600)}`, '');
        lines.push(m.content || '（空）', '');
        if (m.sources?.length) {
          lines.push('参考来源：');
          for (const s of m.sources) lines.push(`- ${s.docName}（相关度 ${Math.round(s.score > 1 ? s.score : s.score * 100)}%）`);
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

  /* ── 会话管理 ─────────────────────────────────────────── */
  const startNewSession = () => {
    stopRef.current?.();
    stopRef.current = null;
    setBusy(false);
    const s = createSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    saveActiveSessionId(project.id, s.id);
    setMessages([greeting(project.name)]);
    setInput('');
    setShowSessions(false);
  };

  const openSession = (id: string) => {
    stopRef.current?.();
    stopRef.current = null;
    setBusy(false);
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    setActiveId(id);
    saveActiveSessionId(project.id, id);
    setMessages(target.messages.length ? (target.messages as Msg[]) : [greeting(project.name)]);
    setInput(loadDraft(project.id, id));
    setShowSessions(false);
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    saveSessions(project.id, next);
    if (id === activeId) {
      const fallback = next[0];
      setActiveId(fallback?.id ?? createSession().id);
      setMessages(fallback?.messages.length ? (fallback.messages as Msg[]) : [greeting(project.name)]);
    }
    toast('info', '会话已删除');
  };

  const renameSession = (id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s));
      saveSessions(project.id, next);
      return next;
    });
  };

  const filteredSessions = useMemo(
    () => (sessionFilter.trim() ? sessions.filter((s) => s.title.toLowerCase().includes(sessionFilter.trim().toLowerCase())) : sessions),
    [sessions, sessionFilter],
  );
  const activeSession = sessions.find((s) => s.id === activeId);

  /* ── 输入区 ───────────────────────────────────────────── */
  const slashFiltered = input.startsWith('/') ? SLASH_COMMANDS.filter((c) => c.name.includes(input.slice(1))).slice(0, 5) : [];
  const applySlash = (c: (typeof SLASH_COMMANDS)[number]) => {
    setInput(c.template);
    setSlashOpen(false);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组词中的 Enter 不能当作发送（历史缺陷：拼音未上屏就发出）
    if (e.nativeEvent.isComposing) return;
    if (slashOpen && slashFiltered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashActive((a) => Math.min(a + 1, slashFiltered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashActive((a) => Math.max(a - 1, 0)); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applySlash(slashFiltered[slashActive] ?? slashFiltered[0]); return; }
      if (e.key === 'Escape') { setSlashOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  useEffect(() => {
    if (!input.startsWith('/')) setSlashOpen(false);
    else { setSlashOpen(true); setSlashActive(0); }
  }, [input]);

  return (
    <div className="h-full flex gap-3 min-h-0">
      {/* 会话侧栏：新建 / 搜索 / 重命名 / 删除 */}
      <aside className={`${showSessions ? 'flex' : 'hidden'} lg:flex w-full lg:w-56 shrink-0 flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--card)] min-h-0`} aria-label="会话列表">
        <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 space-y-2">
          <button onClick={startNewSession} className="w-full flex items-center justify-center gap-1.5 rounded-lg brand-btn text-white text-xs font-medium py-2">
            <Plus size={13} /> 新对话
          </button>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent pl-7 pr-2 py-1.5 text-xs outline-none focus:border-teal-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {filteredSessions.length === 0 && <div className="text-[11px] text-slate-400 text-center py-6">暂无会话</div>}
          {filteredSessions.map((s) => (
            <div key={s.id} className={`group rounded-lg px-2 py-1.5 cursor-pointer border ${s.id === activeId ? 'border-teal-300 bg-teal-50/70 dark:bg-teal-900/20 dark:border-teal-700' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'}`} onClick={() => openSession(s.id)}>
              <div className="flex items-center gap-1">
                <MessageSquare size={11} className="text-slate-400 shrink-0" />
                <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">{s.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const t = window.prompt('重命名会话', s.title);
                    if (t && t.trim()) renameSession(s.id, t.trim());
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-teal-600"
                  aria-label="重命名会话"
                ><Pencil size={11} /></button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500"
                  aria-label="删除会话"
                ><Trash2 size={11} /></button>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 pl-4">{new Date(s.updatedAt).toLocaleDateString('zh-CN')} · {s.messages.length} 条</div>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-1 min-w-0 max-w-3xl mx-auto flex flex-col min-h-0">
        <Card className="flex-1 flex flex-col min-h-0">
          <div className="px-3 sm:px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 shrink-0 flex-wrap">
            <button className="lg:hidden p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setShowSessions((v) => !v)} aria-label="会话列表">
              <MessageSquare size={15} />
            </button>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{activeSession?.title || '新对话'}</span>
            <div className="ml-auto flex items-center gap-1.5 min-w-0 flex-wrap">
              <button onClick={startNewSession} className="lg:hidden flex items-center gap-1 text-xs rounded-md px-1.5 py-1 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-teal-600 hover:border-teal-400" title="新建对话">
                <Plus size={12} /><span className="hidden sm:inline">新对话</span>
              </button>
              <button onClick={exportSnapshot} disabled={!hasConversation} className="flex items-center gap-1 text-xs rounded-md px-1.5 py-1 border text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-teal-600 hover:border-teal-400 disabled:opacity-40 disabled:cursor-not-allowed" title="导出当前会话为 Markdown">
                <Download size={12} /><span className="hidden sm:inline">导出</span>
              </button>
              {models.length > 0 && (
                <select className="text-xs bg-transparent text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-1 max-w-[130px] outline-none focus:ring-1 focus:ring-teal-500" value={model} onChange={(e) => setModel(e.target.value)} title="本次问答使用的模型">
                  <option value="">默认模型</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              <button onClick={() => setThinking((v) => !v)} aria-pressed={thinking} className={`flex items-center gap-1 text-xs rounded-md px-1.5 py-1 border transition-colors ${thinking ? 'bg-teal-50 dark:bg-teal-500/10 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-600'}`} title="深度思考：先输出推理过程（需模型支持）">
                <Brain size={12} aria-hidden="true" /> 深度思考
              </button>
              <select className="text-xs bg-transparent text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-1 max-w-[150px] outline-none focus:ring-1 focus:ring-teal-500" value={linkedDocId} onChange={(e) => setLinkedDocId(e.target.value)} title="关联论文：结合其正文作答">
                <option value="">关联论文</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
          </div>

          <ErrorBox message={error} />

          {(intent || intentBusy) && (
            <div className="px-4 pt-2 shrink-0">
              <div className="flex items-center gap-2 text-xs bg-teal-50/60 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl px-3 py-1.5 page-in">
                {intentBusy ? (
                  <><Loader2 size={12} className="animate-spin text-teal-600" /><span className="text-slate-500 dark:text-slate-400" role="status">正在识别意图…</span></>
                ) : intent ? (
                  <>
                    <Sparkles size={12} className="text-teal-600 shrink-0" />
                    <span className="text-slate-600 dark:text-slate-300 truncate">意图：<b className="text-teal-700 dark:text-teal-300">{intent.label}</b>（{Math.round(intent.confidence * 100)}%）</span>
                    {intent.route !== '/chat' && (
                      <button className="ml-auto flex items-center gap-1 shrink-0 text-teal-700 dark:text-teal-300 hover:underline" onClick={() => { window.location.hash = intent.route; }}>
                        <Navigation size={11} /> 前往
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end group page-in">
                  <div className="max-w-[85%] min-w-0">
                    <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-teal-600 text-white">{m.content}</div>
                    <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <span className="text-[10px] text-slate-400 mr-1">{fmtTime(m.createdAt)}</span>
                      <button onClick={() => copyMsg(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600" title="复制" aria-label="复制提问">
                        {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <button onClick={() => editMsg(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600" title="编辑后重新发送（保留原消息）" aria-label="编辑提问">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => deleteMsg(i)} className="p-1 rounded-md text-slate-400 hover:text-rose-500" title="删除这条消息" aria-label="删除提问">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start group page-in">
                  <div className="max-w-[92%] min-w-0">
                    <div className="rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2.5 text-sm leading-relaxed break-words">
                      {m.reasoning ? (
                        <details open={m.streaming} className="mb-2">
                          <summary className="cursor-pointer select-none text-[11px] font-medium text-teal-700 dark:text-teal-300 flex items-center gap-1 list-none">
                            <Brain size={12} /> 思考过程{m.streaming ? '（进行中）' : ` · ${m.reasoning.length} 字`}
                          </summary>
                          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 border-l-2 border-teal-300 dark:border-teal-700 pl-2.5 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">{m.reasoning}</div>
                        </details>
                      ) : null}
                      {m.content ? (
                        <div className="markdown-body"><Streamdown
                          mode={m.streaming ? 'streaming' : 'static'}
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >{m.content}</Streamdown></div>
                      ) : m.streaming ? (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> 正在生成…</span>
                      ) : null}
                      {m.streaming && m.content && <span className="inline-block w-1.5 h-4 bg-current opacity-60 ml-0.5 align-middle pulse-dot" />}
                      {m.stopped && !m.streaming && (
                        <div className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">已停止生成</div>
                      )}
                    </div>

                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-1.5 space-y-1.5">
                        {m.sources.map((s, si) => {
                          const refId = kbByName.get(s.docName)?.referenceId;
                          const cited = !!citedKeys[s.docName];
                          const pct = Math.round(s.score > 1 ? s.score : s.score * 100);
                          const key = `${i}:${si}`;
                          const open = !!openSrc[key];
                          const hasChunk = !!(s.chunkText && s.chunkText.trim());
                          return (
                            <div key={si} className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 rounded-full px-2 py-0.5 border border-teal-200 dark:border-teal-800">
                                  <FileText size={10} /> {s.docName}{pct > 0 ? ` · ${pct}%` : ''}
                                </span>
                                {hasChunk && (
                                  <button onClick={() => setOpenSrc((mm) => ({ ...mm, [key]: !mm[key] }))} className="inline-flex items-center gap-0.5 text-teal-500 hover:underline">
                                    {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}{open ? '收起原文' : '展开原文'}
                                  </button>
                                )}
                                {cited ? (
                                  <span className="inline-flex items-center gap-0.5 text-teal-700 dark:text-teal-300"><Check size={10} />已引用</span>
                                ) : (
                                  <button onClick={() => openCite(s)} disabled={!refId} title={refId ? '把该来源引用进论文草稿' : '先在知识库把这份资料绑定到文献，再引用'} className="inline-flex items-center gap-0.5 underline underline-offset-2 disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed">
                                    <Quote size={10} />引用
                                  </button>
                                )}
                              </div>
                              {open && hasChunk && (
                                <div className="mt-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--card)] overflow-hidden">
                                  <div className="px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{s.chunkText}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {m.usage && !m.streaming && (
                      <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-2">
                        {m.model && <span className="truncate max-w-[120px]">{m.model}</span>}
                        <span>↑{fmtNum(m.usage.prompt_tokens)} ↓{fmtNum(m.usage.completion_tokens)} tokens</span>
                        <span>{fmtTime(m.createdAt)}</span>
                      </div>
                    )}

                    {m.followUps && m.followUps.length > 0 && !m.streaming && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.followUps.map((f, fi) => (
                          <button key={fi} onClick={() => doSend(f, messages.slice(0, i + 1))} className="text-[11px] bg-[var(--card)] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded-full px-2.5 py-1 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-300 text-left">
                            {f}
                          </button>
                        ))}
                      </div>
                    )}

                    {!m.streaming && (
                      <div className="mt-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity lg:opacity-0" role="toolbar" aria-label="消息操作">
                        {m.stopped && (
                          <button onClick={() => cont(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600" title="继续生成" aria-label="继续生成"><PlayCircle size={13} /></button>
                        )}
                        <button onClick={() => retry(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600" title="重新生成" aria-label="重新生成"><RotateCcw size={13} /></button>
                        <button onClick={() => copyMsg(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600" title="复制回答" aria-label="复制回答">
                          {copiedIdx === i ? <Check size={13} className="text-teal-600" /> : <Copy size={13} />}
                        </button>
                        <button onClick={() => sendToWriting(i)} className="p-1 rounded-md text-slate-400 hover:text-teal-600" title="发送到写作页" aria-label="发送到写作页"><FileText size={13} /></button>
                        <button onClick={() => deleteMsg(i)} className="p-1 rounded-md text-slate-400 hover:text-rose-500" title="删除这条回答" aria-label="删除回答"><Trash2 size={13} /></button>
                        {m.error && <span role="alert" className="text-[10px] text-rose-500 ml-1">{m.error}</span>}
                      </div>
                    )}
                    {m.error && !m.streaming && (
                      <button onClick={() => retry(i)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-600 border border-rose-200 dark:border-rose-900 rounded-md px-2 py-0.5 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                        <RotateCcw size={10} /> 重试
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}
            {!hasConversation && (
              <div className="pt-6">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">试试这样问</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {[
                    { t: '帮我设计研究方案', d: '围绕主题给出研究问题、方法与可行性分析', q: '请围绕我的研究主题设计一份研究方案：研究问题、技术路线、数据来源、可行性风险。' },
                    { t: '综述这一段文献', d: '归纳共识、分歧与空白', q: '请基于我的文献库，归纳该方向的研究共识、主要分歧与研究空白。' },
                    { t: '润色这段摘要', d: '学术表达、逻辑与用词', q: '请润色下面的摘要，提升学术表达与逻辑连贯性，并说明修改理由：' },
                    { t: '解释一个概念', d: '由浅入深 + 例子', q: '请由浅入深解释图神经网络的消息传递机制，并给一个直观例子。' },
                  ].map((c) => (
                    <button
                      key={c.t}
                      onClick={() => { setInput(c.q); requestAnimationFrame(() => taRef.current?.focus()); }}
                      className="text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--card)] p-3 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-teal-900/10 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Sparkles size={12} className="text-teal-600" /> {c.t}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{c.d}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-2.5 sm:p-3 border-t border-slate-100 dark:border-slate-800 shrink-0 relative">
            {slashOpen && slashFiltered.length > 0 && (
              <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--card)] shadow-lg overflow-hidden page-in z-10" role="listbox" aria-label="快捷指令">
                {slashFiltered.map((c, ci) => (
                  <button
                    key={c.name}
                    role="option"
                    aria-selected={ci === slashActive}
                    onClick={() => applySlash(c)}
                    onMouseEnter={() => setSlashActive(ci)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 ${ci === slashActive ? 'bg-teal-50 dark:bg-teal-500/10' : ''}`}
                  >
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 w-14 shrink-0">/{c.name}</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/15 bg-[var(--card)] px-2.5 pt-2 pb-1.5">
              <textarea
                ref={taRef}
                rows={1}
                aria-label="输入科研问题"
                className="w-full resize-none bg-transparent outline-none text-sm leading-relaxed max-h-40 min-h-[24px] placeholder:text-slate-400"
                placeholder='问任何科研问题…（"/" 快捷指令，Shift+Enter 换行）'
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={onComposerKeyDown}
              />
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => setWebSearch((v) => !v)}
                  aria-pressed={webSearch}
                  className={`flex items-center gap-1 text-[11px] rounded-md px-1.5 py-1 border transition-colors ${webSearch ? 'bg-teal-50 dark:bg-teal-500/10 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                  title="联网搜索：本轮回答会检索公开网页（需在设置中配置搜索源，默认 DuckDuckGo）"
                >
                  <Globe size={12} /> 联网{webSearch ? '已开' : ''}
                </button>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 hidden sm:inline">Enter 发送 · Shift+Enter 换行 · Esc 停止</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {busy ? (
                    <button onClick={stop} className="rounded-lg bg-rose-500 text-white px-3 py-1.5 flex items-center gap-1.5 hover:bg-rose-600 text-xs" title="停止生成（Esc）">
                      <Square size={12} /> 停止
                    </button>
                  ) : (
                    <button onClick={send} disabled={!input.trim()} className="rounded-lg brand-btn text-white px-3 py-1.5 flex items-center gap-1.5 text-xs disabled:opacity-50" title="发送（Enter）">
                      <Send size={13} /> 发送
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Modal open={!!citeSource} onClose={() => !citing && setCiteSource(null)} title="引用到论文">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">把来源「{citeSource?.docName}」引用进哪篇论文草稿？</div>
        {docs.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">本项目暂无论文草稿，请到「论文写作」新建一篇</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {docs.map((d) => (
              <button key={d.id} disabled={citing} onClick={() => doCite(d.id)} className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 flex items-center gap-2">
                <FileText size={13} className="text-teal-500 shrink-0" />
                <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{d.title}</span>
                {citing && <Loader2 size={13} className="animate-spin ml-auto" />}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
