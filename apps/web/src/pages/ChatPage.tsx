import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { streamChat } from '../api/client';
import type { Project } from '../types';
import { Card, ErrorBox, Spinner } from '../components/ui';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export function ChatPage({ project }: { project: Project }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      content: `你好！我是 SciFlow 科研助手，正在协助你的项目「${project.name}」。我可以回答论文写作、研究方法、数据分析、投稿策略等问题。`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((s) => [...s, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]);
    setBusy(true);

    streamChat(
      text,
      history,
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
    );
  };

  return (
    <div className="max-w-3xl mx-auto h-full flex flex-col">
      <Card className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 shrink-0">
          <MessageSquare size={15} className="text-teal-600" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">科研问答</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">流式输出 · 多轮对话 · 上下文感知当前项目</span>
        </div>

        <ErrorBox message={error} />

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex page-in ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-sm'
                }`}
              >
                {m.content}
                {m.streaming && <span className="inline-block w-1.5 h-4 bg-current opacity-60 ml-0.5 align-middle pulse-dot" />}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex gap-2 shrink-0">
          <input
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm outline-none focus:border-teal-500 bg-white dark:bg-slate-900"
            placeholder="问任何科研问题…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={busy}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-xl bg-teal-600 text-white px-4 flex items-center gap-1.5 hover:bg-teal-700 disabled:opacity-50 text-sm"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            发送
          </button>
        </div>
      </Card>
    </div>
  );
}
