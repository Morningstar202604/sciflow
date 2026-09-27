import { ReactNode, useEffect } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Info, Loader2, X, XCircle } from 'lucide-react';

const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none whitespace-nowrap active:scale-[0.97] select-none';

export function Button({
  children, variant = 'primary', className = '', disabled, onClick, title, loading,
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'success';
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  loading?: boolean;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm shadow-teal-600/20',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/20',
    outline: 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 bg-white dark:bg-slate-900',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20',
  };
  return (
    <button title={title} className={`${btnBase} ${variants[variant]} ${className}`} disabled={disabled || loading} onClick={onClick}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className = '', onClick, hover }: { children: ReactNode; className?: string; onClick?: () => void; hover?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm ${hover ? 'card-lift cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none transition-all duration-150 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:focus:ring-teal-400/15 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600 ${props.className || ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none transition-all duration-150 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:focus:ring-teal-400/15 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600 resize-none leading-relaxed ${props.className || ''}`}
    />
  );
}

export function Select({ options, value, onChange, className = '' }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none transition-all duration-150 focus:border-teal-500 hover:border-slate-400 dark:hover:border-slate-600 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'teal' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
    green: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    red: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
    teal: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
    blue: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm py-2">
      <Loader2 size={16} className="animate-spin" />
      {label || '处理中…'}
    </div>
  );
}

export function Skeleton({ className = '', lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`skeleton h-3.5 ${className}`} style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 text-center py-12">
      <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-1">
        <Info size={20} className="text-slate-400 dark:text-slate-500" />
      </div>
      <div className="text-sm text-slate-400 dark:text-slate-500">{text}</div>
      {hint && <div className="text-xs text-slate-300 dark:text-slate-600">{hint}</div>}
    </div>
  );
}

export function Modal({ open, title, children, onClose, width = 'max-w-2xl' }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-[2px] p-4 pt-16 overflow-y-auto overlay-in" onClick={onClose}>
      <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full ${width} p-5 modal-in border border-slate-200 dark:border-slate-700`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 统一错误提取：后端 Nest 错误（message）与前端 Error 统一取可读信息 */
export function errMsg(e: any): string {
  return e?.message ? String(e.message) : String(e);
}

/** 可折叠卡片（渐进披露）：默认折叠只显示标题+摘要，点击展开内容 */
export function CollapsibleCard({
  icon,
  title,
  summary,
  open,
  onToggle,
  children,
  right,
}: {
  icon: ReactNode;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Card className="p-5 mt-4">
      <button className="w-full flex items-center justify-between text-left" onClick={onToggle}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          {icon}
          {title}
          {summary ? <span className="text-[11px] font-normal text-slate-400">{summary}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          {right}
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{children}</h2>
      {extra}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2"><XCircle size={14} className="shrink-0" />{message}</div>;
}

export function jsonText<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw || 'null') as T;
  } catch {
    return fallback;
  }
}

/* ---------- 全局 Toast 反馈系统（品牌交互层） ---------- */
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  leaving?: boolean;
}

export function ToastViewport({ items, onDone }: { items: ToastItem[]; onDone: (id: number) => void }) {
  const icons: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 size={15} className="text-emerald-500" />,
    error: <XCircle size={15} className="text-rose-500" />,
    info: <Info size={15} className="text-teal-500" />,
  };
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200 ${t.leaving ? 'toast-out' : 'toast-in'}`}
        >
          {icons[t.kind]}
          <span>{t.text}</span>
          <button className="text-slate-400 hover:text-slate-600 ml-1" onClick={() => onDone(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
