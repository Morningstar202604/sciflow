import { useEffect, useRef, useState } from 'react';
import { Check, Eye, FileText, Pencil } from 'lucide-react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Doc } from '../../types';
import { Badge, Card } from '../../components/ui';

/**
 * WritingEditor — 中间编辑/预览主区。
 * 编辑器：CodeMirror 6（@uiw/react-codemirror + markdown 模式），替代裸 Textarea：
 * 语法高亮 / 行号 / 折行 / 括号配对；keep 的 DOM 契约见下方 handle。
 *
 * 行为说明：
 *  - 标题 blur 回调给父组件（父组件持 doc/docs state，update API 后 refresh 列表）
 *  - 模式切换回调给父组件（editorMode 位于父级）
 *  - 光标插入契约：父组件（WritingPage）经由 `getWritingEditorHandle()` 取
 *    `{ getCursor, setCursor }` 做引用锚点/实验结论的跨组件光标定位。
 */

export interface WritingEditorHandle {
  /** 当前光标（选区起点）；编辑器未挂载返回 null */
  getCursor(): number | null;
  /** 聚焦并把光标放到指定位置 */
  setCursor(pos: number): void;
}

let handle: WritingEditorHandle | null = null;

/** 供 WritingPage 等父级组件获取编辑器句柄（挂载后可用，卸载即失效） */
export function getWritingEditorHandle(): WritingEditorHandle | null {
  return handle;
}

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
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  // 暗色跟随（App 在 <html> 上切换 .dark 类）
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    handle = {
      getCursor: () => {
        const view = cmRef.current?.view;
        if (!view) return null;
        return view.state.selection.main.head;
      },
      setCursor: (pos: number) => {
        const view = cmRef.current?.view;
        if (!view) return;
        view.focus();
        view.dispatch({ selection: { anchor: pos } });
      },
    };
    return () => {
      handle = null;
    };
  }, []);

  return (
    <Card className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
      <div className={`flex-1 min-h-0 flex ${editorMode === 'split' ? 'flex-row' : 'flex-col'}`}>
        {editorMode !== 'preview' && (
          <div
            id="sciflow-editor"
            className={`relative flex-1 min-w-0 min-h-0 h-full overflow-hidden text-[13.5px] ${
              editorMode === 'split' ? 'w-1/2 border-r border-slate-100 dark:border-slate-800' : 'w-full'
            }`}
          >
            {/* CodeMirror 需要显式高度：父级 flex 高度不确定时 height:100% 会塌成一行。
                这里用绝对定位铺满容器，保证编辑区始终占满可用高度。 */}
            <div className="absolute inset-0">
              <CodeMirror
                ref={cmRef}
                value={content}
                onChange={onChangeContent}
                height="100%"
                theme={dark ? 'dark' : 'light'}
                extensions={[markdown({ base: markdownLanguage })]}
                placeholder="在这里撰写论文正文（支持 Markdown）…下方「AI 工具」可做大纲生成、章节起草、润色、翻译、降重"
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: false }}
                style={{ height: '100%' }}
              />
            </div>
          </div>
        )}
        {editorMode !== 'edit' && <div className="flex-1 min-w-0 min-h-0 flex">{renderPreview}</div>}
      </div>
    </Card>
  );
}
