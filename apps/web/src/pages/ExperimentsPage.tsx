import { useContext, useEffect, useState } from 'react';
import { Beaker, Loader2, Play, Save, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { ToastContext } from '../App';
import type { Doc, Experiment, Project } from '../types';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, SectionTitle, Select, Spinner, Textarea } from '../components/ui';

const DEFAULT_CODE = `# 在本机沙箱中运行 Python（超时 10s，临时目录隔离）
import math

result = sum(math.sqrt(i) for i in range(1, 101))
print(f"sqrt(1..100) 之和 = {result:.4f}")

# 如需出图，matplotlib 直接 savefig('fig.png') 即可被自动采集
# import matplotlib
# matplotlib.use('Agg')
# import matplotlib.pyplot as plt
# plt.plot([0, 1, 2], [0, 1, 4])
# plt.savefig('fig.png')
`;

function statusBadge(s: Experiment['status']) {
  if (s === 'ok') return <Badge tone="green">成功</Badge>;
  if (s === 'timeout') return <Badge tone="amber">超时</Badge>;
  return <Badge tone="red">失败</Badge>;
}

export function ExperimentsPage({ project }: { project: Project }) {
  const [exps, setExps] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<Experiment | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [goal, setGoal] = useState('');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [documentId, setDocumentId] = useState('');
  const [running, setRunning] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Experiment | null>(null);
  const [error, setError] = useState('');
  const toast = useContext(ToastContext);

  const load = async () => {
    try {
      const [list, docList] = await Promise.all([
        api.experiments.list(project.id),
        api.documents.list(project.id).catch(() => [] as Doc[]),
      ]);
      setExps(list);
      setDocs(docList);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [project.id]);

  const run = async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setError('');
    try {
      const exp = await api.experiments.run({
        projectId: project.id,
        goal: goal.trim(),
        code,
        documentId: documentId || null,
      });
      setExps((s) => [exp, ...s]);
      setSelected(exp);
      setConclusionDraft(exp.conclusion);
      toast(exp.status === 'ok' ? 'success' : 'info', `实验执行${exp.status === 'ok' ? '成功' : `：${exp.status}`}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const select = (exp: Experiment) => {
    setSelected(exp);
    setConclusionDraft(exp.conclusion);
  };

  const saveConclusion = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const updated = await api.experiments.update(selected.id, { conclusion: conclusionDraft });
      setExps((s) => s.map((x) => (x.id === updated.id ? updated : x)));
      setSelected(updated);
      toast('success', '结论已保存');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.experiments.remove(deleting.id);
      setExps((s) => s.filter((x) => x.id !== deleting.id));
      if (selected?.id === deleting.id) setSelected(null);
      toast('info', '实验记录已删除');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <ErrorBox message={error} />
      <div className="grid lg:grid-cols-5 gap-4">
        {/* 左：新建实验表单 */}
        <Card className="p-5 lg:col-span-2 h-fit">
          <SectionTitle>
            <span className="flex items-center gap-2">
              <Beaker size={16} className="text-teal-600" /> 新建实验
            </span>
          </SectionTitle>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">实验目的 / 假设（可选）</div>
              <Input placeholder="例如：验证牛顿法在 x^2-2 上的收敛速度" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">关联文档（可选）</div>
              <Select
                className="w-full"
                value={documentId}
                onChange={setDocumentId}
                options={[{ value: '', label: '不关联文档' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Python 代码</div>
              <Textarea rows={12} className="font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
            </div>
            <Button onClick={run} loading={running} disabled={!code.trim()} className="w-full">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {running ? '执行中（超时 10s）…' : '运行实验'}
            </Button>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              在本机临时目录隔离执行 python3：超时自动强杀进程组，stdout/stderr 各截断 64KB；matplotlib savefig('*.png') 会自动采集为插图。
            </div>
          </div>
        </Card>

        {/* 右：历史列表 + 详情 */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-5">
            <SectionTitle extra={<span className="text-xs text-slate-400">{exps.length} 条记录</span>}>
              <span className="flex items-center gap-2">
                <Beaker size={16} className="brand-gradient-text" /> 实验记录
              </span>
            </SectionTitle>
            {exps.length === 0 ? (
              <Empty text="暂无实验记录" hint="在左侧写一段 Python 并运行，结果会保存在这里" />
            ) : (
              <div className="space-y-2">
                {exps.map((exp) => (
                  <button
                    key={exp.id}
                    onClick={() => select(exp)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors ${
                      selected?.id === exp.id
                        ? 'border-teal-400 bg-teal-50/70 dark:bg-teal-900/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {statusBadge(exp.status)}
                      <span className="text-sm text-slate-800 dark:text-slate-100 truncate flex-1">
                        {exp.goal || exp.code.split('\n')[0].slice(0, 40) || '未命名实验'}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0">{(exp.runtimeMs / 1000).toFixed(1)}s</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {selected && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                {statusBadge(selected.status)}
                <span className="text-[11px] text-slate-400">
                  {new Date(selected.createdAt).toLocaleString()} · 耗时 {(selected.runtimeMs / 1000).toFixed(2)}s
                </span>
                <button onClick={() => setDeleting(selected)} className="ml-auto text-slate-400 hover:text-rose-500" title="删除记录">
                  <Trash2 size={15} />
                </button>
              </div>

              {selected.goal && <div className="text-sm text-slate-600 dark:text-slate-300 mb-3">目的：{selected.goal}</div>}

              {/* stdout */}
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                标准输出{selected.stdoutTruncated && <span className="text-amber-500">（已截断）</span>}
              </div>
              <pre className="rounded-lg bg-slate-950 text-emerald-300 text-xs font-mono p-3 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap">
                {selected.stdout || '（空）'}
              </pre>
              {/* stderr */}
              {selected.stderr && (
                <>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 mt-3">
                    标准错误{selected.stderrTruncated && <span className="text-amber-500">（已截断）</span>}
                  </div>
                  <pre className="rounded-lg bg-rose-950/60 text-rose-200 text-xs font-mono p-3 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap">
                    {selected.stderr}
                  </pre>
                </>
              )}

              {/* figures */}
              {selected.figures.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">输出图表（{selected.figures.length}）</div>
                  <div className="grid grid-cols-2 gap-3">
                    {selected.figures.map((f, i) => (
                      <img key={i} src={f} alt={`fig-${i + 1}`} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white" />
                    ))}
                  </div>
                </div>
              )}

              {/* conclusion */}
              <div className="mt-4">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">实验结论</div>
                <Textarea rows={3} placeholder="记录本次实验的发现、局限与下一步…" value={conclusionDraft} onChange={(e) => setConclusionDraft(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" onClick={saveConclusion} loading={saving}>
                    <Save size={14} /> 保存结论
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {!selected && exps.length > 0 && <div className="text-center text-xs text-slate-400 py-4">选择一条记录查看输出与图表</div>}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="删除实验记录"
        description="确定删除这条实验记录吗？删除后无法恢复。"
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
