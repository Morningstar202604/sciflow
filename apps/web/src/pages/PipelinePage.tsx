import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleDashed, Loader2, RotateCcw, Workflow, Zap } from 'lucide-react';
import { api } from '../api/client';
import type { Outline, PipelineStep, PipelineTask, Project } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, Spinner, Textarea, jsonText } from '../components/ui';

const STEP_LABELS: Record<string, string> = {
  'topic-verify': '① 主题验证',
  literature: '② 文献调研',
  outline: '③ 大纲生成',
  drafting: '④ 分章起草',
  'quality-gate': '⑤ 质量门评分',
  polish: '⑥ 润色定稿',
  'citation-format': '⑦ 引用格式化',
  complete: '⑧ 完成',
};

export function PipelinePage({ project }: { project: Project }) {
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [editableOutline, setEditableOutline] = useState<Outline | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = tasks.find((t) => t.id === activeId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const list = await api.pipeline.list(project.id);
      setTasks(list);
      if (activeId && list.length) {
        const cur = await api.pipeline.get(activeId);
        setTasks((s) => s.map((t) => (t.id === cur.id ? cur : t)));
      } else if (list.length) {
        setActiveId(list[0].id);
      }
    } catch {
      /* ignore */
    }
  }, [project.id, activeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 轮询活动任务（3 秒）
  useEffect(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    const isBusy = active && (active.status === 'running' || active.status === 'awaiting_confirmation');
    if (isBusy) {
      pollTimer.current = setInterval(() => {
        api.pipeline
          .get(active.id)
          .then((t) => setTasks((s) => s.map((x) => (x.id === t.id ? t : x))))
          .catch(() => undefined);
      }, 3000);
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [active?.id, active?.status]);

  const createTask = async () => {
    if (!topic.trim()) return;
    setCreating(true);
    setError('');
    try {
      const t = await api.pipeline.create(project.id, topic.trim());
      setTasks((s) => [t, ...s]);
      setActiveId(t.id);
      setTopic('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const openConfirm = () => {
    const outlineStep = active?.steps.find((s) => s.key === 'outline');
    if (outlineStep?.output) {
      setEditableOutline(jsonText<Outline>(outlineStep.output, { title: active?.topic || '', sections: [] }));
    }
  };

  const confirmOutline = async () => {
    if (!active || !editableOutline) return;
    setConfirming(true);
    setError('');
    try {
      await api.pipeline.confirmOutline(active.id, editableOutline);
      setEditableOutline(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  };

  const stepTone = (s: PipelineStep) => {
    if (s.status === 'done') return { bg: 'bg-emerald-500 text-white', icon: <Check size={14} /> };
    if (s.status === 'running') return { bg: 'bg-indigo-500 text-white animate-pulse', icon: <Loader2 size={14} className="animate-spin" /> };
    if (s.status === 'awaiting_confirmation') return { bg: 'bg-amber-400 text-white', icon: <CircleDashed size={14} /> };
    if (s.status === 'retry') return { bg: 'bg-rose-100 text-rose-600', icon: <RotateCcw size={14} /> };
    if (s.status === 'failed') return { bg: 'bg-rose-500 text-white', icon: <CircleDashed size={14} /> };
    return { bg: 'bg-slate-200 text-slate-500', icon: <CircleDashed size={14} /> };
  };

  const statusText: Record<string, { text: string; tone: 'blue' | 'amber' | 'green' | 'red' }> = {
    running: { text: '执行中', tone: 'blue' },
    awaiting_confirmation: { text: '等待大纲确认', tone: 'amber' },
    completed: { text: '已完成', tone: 'green' },
    failed: { text: '失败', tone: 'red' },
  };

  return (
    <div className="max-w-5xl mx-auto">
      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-3 text-slate-700 font-semibold">
          <Workflow size={16} className="text-indigo-600" /> 一键全自动流水线
        </div>
        <div className="text-xs text-slate-400 mb-3">
          输入研究主题 → 自动完成 文献调研 → 大纲生成（人工确认）→ 分章起草 → 质量门评分（&lt;80 自动回炉）→ 润色定稿 → 引用格式化
        </div>
        <div className="flex gap-2">
          <Input placeholder="输入研究主题，如：大语言模型在生物医学中的应用" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createTask()} />
          <Button onClick={createTask} disabled={creating || !topic.trim()}>
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />} 启动流水线
          </Button>
        </div>
      </Card>

      {tasks.length === 0 ? (
        <Empty text="暂无流水线任务。输入主题，一条链路自动产出论文初稿" />
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          {/* 任务列表 */}
          <Card className="p-3 lg:col-span-1">
            <div className="text-sm font-semibold text-slate-700 mb-2">任务记录</div>
            <div className="space-y-1.5">
              {tasks.map((t) => {
                const st = statusText[t.status] || statusText.running;
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg px-3 py-2 cursor-pointer border ${
                      activeId === t.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-100 hover:border-indigo-200'
                    }`}
                    onClick={() => setActiveId(t.id)}
                  >
                    <div className="text-sm text-slate-800 truncate">{t.topic}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge tone={st.tone}>{st.text}</Badge>
                      <span className="text-[11px] text-slate-400">{STEP_LABELS[t.currentStep] || t.currentStep}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 任务详情 */}
          <Card className="p-4 lg:col-span-2">
            {!active ? (
              <Empty text="选择左侧任务查看详情" />
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-medium text-slate-800">{active.topic}</div>
                    <div className="text-xs text-slate-400">
                      创建于 {new Date(active.createdAt).toLocaleString()} · 回炉 {active.retryCount} 次
                    </div>
                  </div>
                  <Badge tone={statusText[active.status]?.tone || 'blue'}>{statusText[active.status]?.text || active.status}</Badge>
                </div>

                {active.lastError && <div className="text-xs text-rose-600 bg-rose-50 rounded p-2 mb-3">{active.lastError}</div>}

                {/* 步骤时间线 */}
                <div className="space-y-1.5 mb-4">
                  {active.steps.map((s, i) => {
                    const tone = stepTone(s);
                    return (
                      <div key={s.key} className="flex items-start gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${tone.bg}`}>{tone.icon}</div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${s.status === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}>{STEP_LABELS[s.key] || s.label}</span>
                            {s.retryCount > 0 && <Badge tone="red">回炉 {s.retryCount} 次</Badge>}
                          </div>
                          {s.output && (
                            <div className="text-xs text-slate-400 mt-0.5 line-clamp-2 break-all">{s.output}</div>
                          )}
                        </div>
                        {i < active.steps.length - 1 && <ChevronRight size={13} className="hidden" />}
                      </div>
                    );
                  })}
                </div>

                {/* 大纲确认区 */}
                {active.status === 'awaiting_confirmation' && (
                  <Card className="p-3 bg-amber-50 border-amber-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-amber-800">大纲已生成，请确认后继续起草（Human-in-the-loop）</span>
                      <Button variant="success" className="text-xs" onClick={openConfirm}>
                        查看 / 编辑大纲
                      </Button>
                    </div>
                  </Card>
                )}

                {/* 产物文档 */}
                {active.documentId && (
                  <div className="text-xs text-slate-500 mt-3">
                    产物文档已生成（ID: {active.documentId.slice(0, 8)}…），可到「论文写作」页查看与继续编辑
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* 大纲确认弹窗 */}
      <Modal open={!!editableOutline} title="确认论文大纲" onClose={() => setEditableOutline(null)} width="max-w-3xl">
        {editableOutline && (
          <div>
            <div className="text-xs text-slate-400 mb-2">论文标题</div>
            <Input value={editableOutline.title} onChange={(e) => setEditableOutline({ ...editableOutline, title: e.target.value })} />
            <div className="text-xs text-slate-400 my-2">
              章节（可直接编辑标题，删减行删除章节；确认后进入分章起草）
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {editableOutline.sections?.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    value={s.title}
                    onChange={(e) => {
                      const sections = [...editableOutline.sections];
                      sections[i] = { ...s, title: e.target.value };
                      setEditableOutline({ ...editableOutline, sections });
                    }}
                  />
                  <Button
                    variant="danger"
                    className="px-2 py-1 text-xs"
                    onClick={() => setEditableOutline({ ...editableOutline, sections: editableOutline.sections.filter((_, j) => j !== i) })}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                className="text-xs w-full"
                onClick={() => setEditableOutline({ ...editableOutline, sections: [...editableOutline.sections, { title: '新章节', subsections: [] }] })}
              >
                + 添加章节
              </Button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditableOutline(null)}>
                取消
              </Button>
              <Button onClick={confirmOutline} disabled={confirming}>
                {confirming ? <Spinner /> : <Zap size={15} />} 确认大纲，开始起草
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
