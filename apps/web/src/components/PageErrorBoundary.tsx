import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useContext } from 'react';
import { ToastContext } from '../App';

interface Props {
  children: ReactNode;
  pageName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Page-level error boundary — catches rendering errors within a single page,
 * shows an inline card with retry, fires toast, keeps the app alive.
 */
export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorCard pageName={this.props.pageName} error={this.state.error} onRetry={this.handleReset} />;
    }
    return this.props.children;
  }
}

function ErrorCard({ pageName, error, onRetry }: { pageName: string; error: Error | null; onRetry: () => void }) {
  const toast = useContext(ToastContext);

  const handleRetry = () => {
    toast('info', `${pageName}：页面已重置，请重试`);
    onRetry();
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-md w-full rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-900/10 p-6 text-center space-y-4">
        <div className="flex justify-center">
          <span className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
            <AlertTriangle size={26} className="text-rose-500 dark:text-rose-400" />
          </span>
        </div>
        <div>
          <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
            {pageName} 出现错误
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            页面渲染时发生异常，请点击下方按钮重置。
          </div>
        </div>
        {error && (
          <div className="text-xs text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-md px-3 py-2 font-mono break-all">
            {error.message}
          </div>
        )}
        <button
          onClick={handleRetry}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium brand-btn text-white"
        >
          <RefreshCw size={14} />
          重试
        </button>
      </div>
    </div>
  );
}
