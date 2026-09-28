import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Loader2, MessageSquare, Send, Sparkles, Wand2, Languages, FileText } from 'lucide-react';
import { api, streamChat } from '../api/client';
import type { Doc, IntentResult, Project } from '../types';
import { Card } from '../components/ui';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

/**
 * 内联 AI 助手（写作页右侧面板）
 * 全程贯通当前论文：问答自动注入当前文档的标题/大纲/正文上下文；
 * 快捷动作：润色全文 / 翻译 / 生成摘要，结果直接回写当前文档。
 */
export function ChatPanel({
  project,
  doc,
  onDocUpdated,
}: {
  project: Project;
  doc: Doc | null;
  onDocUpdated: (patch: { content?: string; abstract?: string }) => void;
}) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: `我是写作助手，已关联当前论文「${doc?.title || '未命名'}」。可以问我写作、逻辑、修改建议，或点下方快捷动作。` },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  /** 当前文档上下文（标题+大纲+正文摘要） */
  const docContext = () => {
    if (!doc) return '';
    let outline = '';
    try {
      const o = JSON.parse(doc.outline || '[]');
      outline = Array.isArray(o.sections) ? o.sections.map((s: any) => s.title).join(' / ') : '';
    } catch {
      outline = '';
    }
    return `标题：${doc.title}\n大纲：${outline || '（未设置）'}\n正文：${(doc.content || '').replace(/[#*`>]/g, '').slice(0, 2200)}`;
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    setMessages((s) => [...s, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]);
    setBusy(true);
    if (doc) {
      api.judgment
        .intent(text, doc.title)
        .then(setIntent)
        .catch(() => undefined);
    }
    streamChat(
      text,
      messages.map((m) => ({ role: m.role, content: m.content })),
      (full) => {
        setMessages((s) => {
          const next = [...s];
          const last = next[next.length - 1];
          if (last?.streaming) next[next.length - 1] = { ...last, content: full };
          return next;
        });
      },
      () => {
        setMessages((s) => s.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
        setBusy(false);
      },
      (msg) => {
        setMessages((s) => s.map((m) => (m.streaming ? { ...m, content: m.content || '（回答失败）', streaming: false } : m)));
        setError(msg);
        setBusy(false);
      },
      project.id,
      docContext(),
    );
  };

  const runAction = async (kind: 'polish' | 'translate' | 'abstract') => {
    if (!doc || actionBusy) return;
    setActionBusy(kind);
    setError('');
    try {
      if (kind === 'abstract') {
        const r = await api.documents.abstract(doc.id);
        onDocUpdated({ abstract: r.abstract });
        setMessages((s) => [...s, { role: 'assistant', content: `已生成摘要：\n\n${r.abstract}\n\n关键词：${r.keywords.join('、')}` }]);
      } else if (kind === 'polish') {
        const r = await api.documents.polish(doc.id, doc.content || '', 'polish');
        onDocUpdated({ content: r.polished });
        setMessages((s) => [...s, { role: 'assistant', content: `已润色全文（正文已更新）。\n\n主要修改：${r.reason || '见润色历史'}` }]);
      } else {
        const r = await api.documents.translate(doc.id, doc.content || '', 'en');
        onDocUpdated({ content: r.translated });
        setMessages((s) => [...s, { role: 'assistant', content: '已翻译为英文全文（正文已更新）。' }]);
      }
    } catch {
      setError('操作失败，请稍后重试');
    } finally {
      setActionBusy('');
    }
  };

  return (
    <Card className={`w-72 shrink-0 flex flex-col min-h-0 ${open ? '' : 'w-10 cursor-pointer'} transition-all`}>
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-slate-800 cursor-pointer shrink-0"
        onClick={() => setOpen((v) => !v)}
      >
        <Bot size={14} className="text-teal-600" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex-1">AI 写作助手</span>
        {open ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronUp size={13} className="text-slate-400" />}
      </div>
      {open && (
        <>
          {doc && (
            <div className="px-3 py-1.5 text-[11px] text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1 shrink-0">
              <FileText size={11} /> 已关联：<span className="truncate">{doc.title}</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`text-xs whitespace-pre-wrap leading-relaxed ${m.role === 'assistant' ? 'text-slate-600 dark:text-slate-300' : 'text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5'}`}>
                {m.content || (m.streaming ? <Loader2 size={12} className="animate-spin text-teal-500" /> : '')}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          {intent && (
            <div className="px-3 pb-1 shrink-0">
              <div className="text-[11px] bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-md px-2 py-1.5 flex items-center gap-1">
                <Sparkles size={11} /> 意图识别：{intent.label || intent.intent}
              </div>
            </div>
          )}
          {error && <div className="px-3 pb-1 text-[11px] text-rose-500 shrink-0">{error}</div>}
          <div className="p-2 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <div className="flex gap-1 mb-1.5">
              <button
                onClick={() => runAction('polish')}
                disabled={!doc || !!actionBusy}
                className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {actionBusy === 'polish' ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} 润色全文
              </button>
              <button
                onClick={() => runAction('translate')}
                disabled={!doc || !!actionBusy}
                className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {actionBusy === 'translate' ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />} 翻译全文
              </button>
              <button
                onClick={() => runAction('abstract')}
                disabled={!doc || !!actionBusy}
                className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {actionBusy === 'abstract' ? <Loader2 size={11} className="animate-spin" /> : <MessageSquare size={11} />} 生成摘要
              </button>
            </div>
            <div className="flex gap-1.5">
              <input
                className="flex-1 min-w-0 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-slate-400"
                placeholder={doc ? '问当前论文…' : '写作问题…'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="rounded-md bg-teal-600 hover:bg-teal-700 text-white px-2 py-1.5 disabled:opacity-50"
                title="发送"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
