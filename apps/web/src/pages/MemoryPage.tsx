import { useCallback, useEffect, useState } from 'react';
import { Brain, History, Lightbulb, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { MemoryItem } from '../types';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Spinner, Textarea } from '../components/ui';

/** 记忆中心（Phase 2：Agentic Memory）
 * - 情景记忆 episodic：流水线完成时自动沉淀（主题/结构/评分），供后续任务参考
 * - 程序记忆 procedural：写作风格指令，起草时自动注入（可自行维护）
 */
export function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [type, setType] = useState<'episodic' | 'procedural' | ''>('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MemoryItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.memory.list(type, q);
      setItems(list);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [type, q]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addMemory = async () => {
    if (!newContent.trim()) return;
    setSaving(true);
    try {
      await api.memory.add(
        'procedural',
        newContent.trim(),
        undefined,
        newKeywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean),
      );
      setNewContent('');
      setNewKeywords('');
      setShowAdd(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = (item: MemoryItem) => {
    setDeleting(item);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.memory.remove(deleting.id);
      setDeleting(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
      setDeleting(null);
    }
  };

  const typeTone = (t: string) => (t === 'procedural' ? 'teal' : 'blue') as 'teal' | 'blue';

  return (
    <div className="max-w-4xl mx-auto">
      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-semibold">
          <Brain size={16} className="brand-gradient-text" /> 记忆中心
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 mb-3">
          Agentic Memory：情景记忆自动沉淀每次完成的研究任务；程序记忆保存写作风格指令，起草时自动注入（对标 NotebookLM / Agentic Memory）
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {(['', 'episodic', 'procedural'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  type === t ? 'bg-white dark:bg-slate-900 shadow text-teal-700 font-medium' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {t === '' ? '全部' : t === 'episodic' ? '情景记忆' : '程序记忆'}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-40 flex items-center gap-1">
            <Search size={14} className="text-slate-400 dark:text-slate-500" />
            <Input placeholder="按关键词搜索（如：图神经、综述）" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={15} /> 新增写作指令
          </Button>
        </div>
      </Card>

      {showAdd && (
        <Card className="p-4 mb-4 border-teal-200 bg-teal-50/50 card-lift">
          <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-teal-800">
            <Lightbulb size={15} /> 新增程序记忆（写作风格指令）
          </div>
          <Textarea
            placeholder="例：论文写作要求——引言用漏斗式结构；方法节必须写明数据来源与超参数；结论给出未来方向。"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-2 mt-2">
            <Input placeholder="关键词，逗号分隔（可选）" value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)} />
            <Button onClick={addMemory} disabled={saving || !newContent.trim()}>
              {saving ? <Spinner /> : '保存'}
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              取消
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="py-10 flex justify-center">
          <Spinner label="加载记忆…" />
        </div>
      ) : items.length === 0 ? (
        <Empty text="暂无记忆。运行一次全自动流水线会自动沉淀情景记忆；或点击「新增写作指令」保存写作风格" />
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <Card key={m.id} className="p-3.5 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {m.type === 'procedural' ? <Lightbulb size={16} className="text-teal-500" /> : <History size={16} className="text-blue-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={typeTone(m.type)}>{m.type === 'procedural' ? '程序记忆' : '情景记忆'}</Badge>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(m.createdAt).toLocaleString()}</span>
                  {m.keywords.map((k) => (
                    <span key={k} className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5">
                      {k}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all">{m.content}</div>
              </div>
              <button className="text-slate-300 hover:text-rose-500 shrink-0" title="删除" onClick={() => remove(m)}>
                <Trash2 size={15} />
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* 删除记忆确认弹窗 */}
      <ConfirmDialog
        open={!!deleting}
        title="删除记忆"
        description={deleting ? `确定要删除这条${deleting.type === 'procedural' ? '程序记忆' : '情景记忆'}吗？删除后无法恢复。` : undefined}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
