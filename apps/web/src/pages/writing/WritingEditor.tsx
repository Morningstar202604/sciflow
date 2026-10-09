import { useEffect, useRef } from 'react';
import { Check, Eye, FileText, Pencil } from 'lucide-react';
import type { Doc } from '../../types';
import { Badge, Card, Textarea } from '../../components/ui';

/**
 * WritingEditor — 中间编辑/预览主区。
 * 包含：文档标题栏、⌘S 已保存 badge、版本号、编辑/分栏/预览模式切换按钮、
 *       textarea 编辑态、split 右半预览 / 纯预览态子组件透传插槽。
 *
 * 行为说明：
 *  - 标题 blur 回调给父组件（父组件持 doc/docs state，update API 后 refresh 列表）
 *  - 模式切换回调给父组件（editorMode 位于父级）
 *  - textarea DOM 通过 ref 暴露 id="sciflow-editor"，供父组件 getEditorTa() 做光标定位
 *    （插入引用锚点 / 实验结论等跨组件光标操作）
 */
export function WritingEditor({
  doc,
  content,
  editorMode,
  savedAt,
  onChangeContent,
  onTitleBlur,
  onModeChange,
  renderPreview,
}: {
  doc: Doc;
  content: string;
  editorMode: 'edit' | 'preview' | 'split';
  savedAt: number | null;
  onChangeContent: (v: string) => void;
  /** 标题 blur 事件：传入新标题字符串；父组件负责 API 更新与状态同步 */
  onTitleBlur: (newTitle: string) => void;
  onModeChange: (mode: 'edit' | 'preview' | 'split') => void;
  /** 预览区 JSX 插槽（WritingPreview 由父组件组装后传入） */
  renderPreview: React.ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 暴露 DOM id 供父组件 getEditorTa() 定位
  useEffect(() => {
    if (taRef.current) taRef.current.id = 'sciflow-editor';
  }, []);

  return (
    <Card className={`flex-1 min-w-0 flex-col ${editorMode === 'split' ? 'md:w-1/2' : 'w-full'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <input
          className="font-medium text-slate-800 dark:text-slate-100 outline-none flex-1 bg-transparent min-w-0"
          defaultValue={doc.title}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== doc.title) onTitleBlur(t);
          }}
        />
        {savedAt && <span className="text-xs text-emerald-500 flex items-center gap-1 page-in shrink-0"><Check size={12} />已保存</span>}
        <Badge tone="blue">v{doc.version}</Badge>
        {/* Markdown 预览切换（编辑 / 预览 / 分栏，科研写作标配） */}
        <div className="flex items-center gap-0.5 ml-auto bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 shrink-0">
          {(['edit', 'split', 'preview'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              title={m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-all duration-150 ${
                editorMode === m ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/25' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {m === 'edit' ? <Pencil size={11} /> : m === 'preview' ? <Eye size={11} /> : <FileText size={11} />}
              {m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
            </button>
          ))}
        </div>
      </div>
      <div className={`flex-1 min-h-0 ${editorMode === 'split' ? 'flex' : ''}`}>
        {editorMode !== 'preview' && (
          <Textarea
            ref={taRef}
            className={`flex-1 border-0 rounded-none focus:ring-0 focus:border-0 p-4 text-[13.5px] leading-relaxed ${editorMode === 'split' ? 'w-1/2 border-r border-slate-100 dark:border-slate-800' : 'w-full'}`}
            value={content}
            onChange={(e) => onChangeContent(e.target.value)}
            placeholder="在这里撰写论文正文（支持 Markdown）…可使用右侧 AI 工具：大纲生成、章节起草、润色、翻译、降重"
          />
        )}
        {editorMode !== 'edit' && renderPreview}
      </div>
    </Card>
  );
}
