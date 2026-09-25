import { ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';

const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

export function Button({
  children, variant = 'primary', className = '', disabled, onClick, title,
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'success';
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50 bg-white',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  };
  return (
    <button title={title} className={`${btnBase} ${variants[variant]} ${className}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white ${props.className || ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white resize-none leading-relaxed ${props.className || ''}`}
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
      className={`rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-rose-100 text-rose-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    blue: 'bg-sky-100 text-sky-700',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
      <Loader2 size={16} className="animate-spin" />
      {label || '处理中…'}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="text-center text-slate-400 text-sm py-10">{text}</div>;
}

export function Modal({ open, title, children, onClose, width = 'max-w-2xl' }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-16 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-2xl w-full ${width} p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base font-semibold text-slate-800">{children}</h2>
      {extra}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{message}</div>;
}

export function jsonText<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw || 'null') as T;
  } catch {
    return fallback;
  }
}
