import { useContext, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { ToastContext } from '../App';
import { Button, Modal, errMsg } from '../components/ui';
import type { CiteStyle, RenderCitationsResult } from '../types';

/** 序号样式集合（[n] 插入序，无需正文重排） */
const NUMBERED_STYLES: CiteStyle[] = ['ieee', 'vancouver', 'gbt', 'nature', 'springer', 'acs'];

/**
 * 著者-年重排入口（缺口#4 前端半）——独立 lazy chunk：按钮 + 预览 Modal + 调用全在此。
 * 后端 render-citations 为纯函数预览、永不落库；确认后由 onApply(content) 回 WritingPage，
 * 走 setContent → 1.2s 防抖自动保存链（前端保存，与手动 PATCH 不冲突）。
 */
export function CiteReorderButton({
  docId,
  style,
  citationsCount,
  onApply,
}: {
  docId: string | null;
  /** 当前选中的导出样式（exportFormat），apa/chicago 为著者-年 */
  style: string;
  citationsCount: number;
  /** 应用重排后正文到编辑器（仅 setContent，自动保存链接管持久化） */
  onApply: (content: string) => void;
}) {
  const toast = useContext(ToastContext);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RenderCitationsResult | null>(null);

  const open = () => {
    if (!docId) return;
    if (NUMBERED_STYLES.includes(style as CiteStyle)) {
      toast('info', '序号样式（[n]）无需正文重排，列表已按引用序渲染');
      return;
    }
    if (citationsCount === 0) {
      toast('info', '文档还没有引用，先从文献库插入锚点');
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await api.documents.renderCitations(docId, style as CiteStyle, true);
        setResult(res);
      } catch (e: unknown) {
        toast('error', '重排预览失败：' + errMsg(e));
      } finally {
        setLoading(false);
      }
    })();
  };

  const apply = () => {
    if (!result) return;
    onApply(result.content);
    setResult(null);
    toast('success', '已应用著者-年重排，将自动保存');
  };

  const allLines = result ? result.content.split('\n') : [];
  const previewLines = allLines.slice(0, 60);
  const truncated = allLines.length > 60;

  return (
    <>
      <Button
        variant="outline"
        className="text-xs w-full mt-1.5"
        onClick={open}
        disabled={loading || !docId}
        title="apa/chicago 著者-年样式：把正文 [n] 重排为 (作者, 年) 预览并应用"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 著者-年重排预览（apa / chicago）
      </Button>

      {result && (
        <Modal open title={`著者-年重排预览 · ${result.style.toUpperCase()}`} onClose={() => setResult(null)} width="max-w-3xl">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {result.changed ? (
              <>已把正文 <span className="font-mono">[n]</span> 锚点重排为著者-年形式，文末列表按作者姓字母序重排。确认后覆盖编辑器正文并自动保存，可 ⌘Z 回退。幂等：重复重排结果逐字节一致。</>
            ) : (
              <>当前样式下正文无需重排（[n] 保持插入序），结果与原文一致。</>
            )}
          </div>
          <div className="text-[11px] font-medium text-slate-400 mb-1">正文预览（前 {previewLines.length} 行）</div>
          <div className="font-mono text-[11px] leading-relaxed bg-slate-50 dark:bg-slate-900/60 rounded p-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">
            {previewLines.join('\n')}
            {truncated ? '\n…（后文省略，应用时完整覆盖）' : ''}
          </div>
          <div className="text-[11px] font-medium text-slate-400 mt-3 mb-1">文末参考文献（按作者姓排序，{result.references.length} 条）</div>
          <div className="text-xs bg-slate-50 dark:bg-slate-900/60 rounded p-2 max-h-40 overflow-auto space-y-1">
            {result.references.map((r, i) => (
              <div key={i} className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{r}</div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" className="text-xs" onClick={() => setResult(null)}>
              取消（不动原文）
            </Button>
            <Button className="text-xs" onClick={apply} disabled={!result.changed}>
              确认应用重排
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
