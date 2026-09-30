import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Bot, Brain, Check, ChevronRight, CircleDashed, Eye, Loader2, RotateCcw, Workflow, Zap } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { AgentRun, Outline, PipelineStep, PipelineTask, Project, ReactTraceStep } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, Spinner, Textarea, jsonText } from '../components/ui';
import { HBar, ProgressRing, Sparkline } from '../components/charts';

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

/** 多 Agent 协作映射：每个流水线步骤由哪个 Agent 角色负责（对标 Deep Research / Agent Laboratory 分工） */
const AGENT_MAP: Record<string, { role: string; tone: 'blue' | 'green' | 'teal' | 'amber' | 'slate' }> = {
  'topic-verify': { role: 'Planner', tone: 'slate' },
  literature: { role: 'Researcher', tone: 'blue' },
  outline: { role: 'Planner', tone: 'slate' },
  drafting: { role: 'Writer', tone: 'green' },
  'quality-gate': { role: 'Reviewer', tone: 'amber' },
  polish: { role: 'Editor', tone: 'teal' },
  'citation-format': { role: 'Editor', tone: 'teal' },
  complete: { role: 'Manager', tone: 'slate' },
};

export function PipelinePage({ project }: { project: Project }) {
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [editableOutline, setEditableOutline] = useState<Outline | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const toast = useContext(ToastContext);
  const [agents, setAgents] = useState<AgentRun[]>([]);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = tasks.find((t) => t.id === activeId) ?? null;

  /** 研究计划（Planner 输出，存在 topic-verify 步骤的 output JSON 中） */
  const activePlan = (() => {
    if (!active) return null;
    const step = active.steps.find((s) => s.key === 'topic-verify');
    if (!step?.output) return null;
    try {
      const p = JSON.parse(step.output);
      return p?.researchQuestions && p?.objective ? p : null;
    } catch {
      return null;
    }
  })();

  /** ReAct 轨迹（think → act → observe） */
  const activeTrace = (() => {
    if (!active) return [];
    try {
      const t = JSON.parse(active.trace || '[]');
      return Array.isArray(t) ? (t as ReactTraceStep[]) : [];
    } catch {
      return [];
    }
  })();

  const normalize = (t: PipelineTask): PipelineTask => ({
    ...t,
    steps: Array.isArray(t.steps) ? t.steps : jsonText<PipelineStep[]>(String(t.steps || '[]'), []),
    trace: typeof t.trace === 'string' ? t.trace : JSON.stringify(t.trace || []),
  });

  const refresh = useCallback(async () => {
    try {
      const list = (await api.pipeline.list(project.id)).map(normalize);
      setTasks(list);
      if (activeId && list.length) {
        const cur = normalize(await api.pipeline.get(activeId));
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
          .then((t) => setTasks((s) => s.map((x) => (x.id === t.id ? normalize(t) : x))))
          .catch(() => undefined);
        api.pipeline.agents(active.id).then(setAgents).catch(() => undefined);
      }, 3000);
      api.pipeline.agents(active.id).then(setAgents).catch(() => undefined);
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
      toast('success', '流水线已启动，Agent 编排开始执行');
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
    if (s.status === 'done') return { bg: 'brand-logo text-white', icon: <Check size={14} /> };
    if (s.status === 'running') return { bg: 'brand-logo text-white brand-breathe', icon: <Loader2 size={14} className="animate-spin" /> };
    if (s.status === 'awaiting_confirmation') return { bg: 'bg-amber-400 text-white', icon: <CircleDashed size={14} /> };
    if (s.status === 'retry') return { bg: 'bg-rose-100 text-rose-600', icon: <RotateCcw size={14} /> };
    if (s.status === 'failed') return { bg: 'bg-rose-500 text-white', icon: <CircleDashed size={14} /> };
    return { bg: 'bg-slate-200 text-slate-500 dark:text-slate-400', icon: <CircleDashed size={14} /> };
  };

  const statusText: Record<string, { text: string; tone: 'blue' | 'amber' | 'green' | 'red' }> = {
    running: { text: '执行中', tone: 'blue' },
    awaiting_confirmation: { text: '等待大纲确认', tone: 'amber' },
    completed: { text: '已完成', tone: 'green' },
    failed: { text: '失败', tone: 'red' },
    cancelled: { text: '已取消', tone: 'red' },
    interrupted: { text: '已中断', tone: 'amber' },
  };

  return (
    <div className="max-w-5xl mx-auto">
      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-3 text-slate-700 dark:text-slate-200 font-semibold">
          <Workflow size={16} className="brand-gradient-text" /> 一键全自动流水线
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          输入研究主题 → 多智能体自动完成 文献调研 → 大纲确认 → 分章起草 → 7 维质量门（&lt;80 自动回炉打磨）→ 润色定稿 → 引用格式化
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
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">任务记录</div>
            <div className="space-y-1.5">
              {tasks.map((t) => {
                const st = statusText[t.status] || statusText.running;
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg px-3 py-2 cursor-pointer border transition-all duration-150 ${
                      activeId === t.id
                        ? 'border-teal-300 dark:border-teal-700 bg-teal-50/80 dark:bg-teal-900/25 border-l-[3px] border-l-teal-500 shadow-[0_2px_12px_-4px_rgba(13,148,136,0.35)]'
                        : 'border-slate-100 dark:border-slate-800 hover:border-teal-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                    onClick={() => setActiveId(t.id)}
                  >
                    <div className="text-sm text-slate-800 dark:text-slate-100 truncate">{t.topic}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge tone={st.tone}>{st.text}</Badge>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">{STEP_LABELS[t.currentStep] || t.currentStep}</span>
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
                    <div className="font-medium text-slate-800 dark:text-slate-100">{active.topic}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      创建于 {new Date(active.createdAt).toLocaleString()} · 回炉 {active.retryCount} 次
                    </div>
                  </div>
                  <Badge tone={statusText[active.status]?.tone || 'blue'}>{statusText[active.status]?.text || active.status}</Badge>
                </div>

                {/* 进度环：8 步中已完成占比，label=当前步骤 */}
                {(() => {
                  const doneCount = active.steps.filter((s) => s.status === 'done').length;
                  const totalSteps = active.steps.length || 8;
                  return (
                    <div className="flex items-center gap-3 mb-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 px-3 py-2">
                      <ProgressRing
                        value={(doneCount / totalSteps) * 100}
                        size={56}
                        thickness={6}
                        label={STEP_LABELS[active.currentStep] || active.currentStep}
                        sub={`${doneCount}/${totalSteps} 步已完成`}
                      />
                    </div>
                  );
                })()}

                {active.lastError && <div className="text-xs text-rose-600 bg-rose-50 rounded p-2 mb-3">{active.lastError}</div>}

                {/* 研究计划（Phase 1a：Planner）+ ReAct 轨迹（Phase 1b） */}
                {activePlan && (
                  <Card className="p-3 mb-3 bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <Brain size={13} className="text-teal-500" /> Planner 研究计划
                      </span>
                      <Button variant="outline" className="text-xs px-2 py-1" onClick={() => setShowPlan((v) => !v)}>
                        <Eye size={12} /> {showPlan ? '收起' : '查看'}
                      </Button>
                    </div>
                    {showPlan && (
                      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                        <div><span className="text-slate-400 dark:text-slate-500">目标：</span>{activePlan.objective}</div>
                        <div>
                          <span className="text-slate-400 dark:text-slate-500">子问题：</span>
                          {(activePlan.researchQuestions as string[]).map((q, i) => (
                            <span key={i} className="inline-block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 mr-1 mb-1">{q}</span>
                          ))}
                        </div>
                        {activePlan.draftingPlan?.sections && (
                          <div>
                            <span className="text-slate-400 dark:text-slate-500">章节规划：</span>
                            {(activePlan.draftingPlan.sections as string[]).join(' → ')}
                          </div>
                        )}
                        {activePlan.risks?.length > 0 && (
                          <div><span className="text-slate-400 dark:text-slate-500">风险：</span>{activePlan.risks.join('；')}</div>
                        )}
                      </div>
                    )}
                  </Card>
                )}

                {activeTrace.length > 0 && (
                  <Card className="p-3 mb-3 bg-blue-50/50 border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                        <Zap size={13} className="text-blue-500" /> ReAct 自主检索轨迹（think → act → observe）
                      </span>
                      <Button variant="outline" className="text-xs px-2 py-1" onClick={() => setShowTrace((v) => !v)}>
                        <Eye size={12} /> {showTrace ? '收起' : `${activeTrace.length} 步`}
                      </Button>
                    </div>
                    {showTrace && (
                      <div className="space-y-1.5">
                        {(() => {
                          const foundSeries = activeTrace.filter((t) => t.action === 'search').map((t) => t.found);
                          return foundSeries.length > 1 ? (
                            <div className="flex items-center gap-2 mb-2 rounded bg-white/60 dark:bg-slate-900/40 px-2 py-1.5">
                              <span className="text-[11px] text-blue-600 dark:text-blue-400 shrink-0">检索命中收敛</span>
                              <Sparkline data={foundSeries} width={110} height={26} stroke="#3b82f6" />
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-auto shrink-0">{foundSeries.join(' → ')}</span>
                            </div>
                          ) : null;
                        })()}
                        {activeTrace.map((t, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 text-[10px]">
                              {t.round}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-blue-800 font-medium">
                                {t.action === 'done' ? '✅ 收尾：' : '🔍 检索：'}
                                {t.action === 'done' ? t.thought : `「${t.query}」`}
                                {t.action === 'search' && <span className="text-slate-400 dark:text-slate-500">（获得 {t.found} 篇）</span>}
                              </div>
                              {t.thought && t.action === 'search' && (
                                <div className="text-slate-500 dark:text-slate-400 mt-0.5 break-all">{t.thought}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                {/* Supervisor 编排视图（Phase 3：子 Agent 执行轨迹） */}
                {agents.length > 0 && (
                  <Card className="p-3 mb-3 bg-teal-50/40 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300">
                        <Bot size={13} className="text-teal-600" /> Supervisor 多 Agent 编排
                      </span>
                      <Button variant="outline" className="text-xs px-2 py-1" onClick={() => setShowAgents((v) => !v)}>
                        <Eye size={12} /> {showAgents ? '收起' : `${agents.length} 个 Agent`}
                      </Button>
                    </div>
                    {showAgents && (
                      <div className="text-xs">
                        <div className="flex items-center gap-1.5 mb-2 text-teal-600 dark:text-teal-400">
                          <Activity size={12} /> 规划 → 并行检索 → 写作 → 评审 → 润色（每格一个子 Agent 执行单元）
                        </div>
                        {/* 各 Agent 角色耗时汇总 HBar（value=总耗时秒，sub=实例数，hint=单实例明细） */}
                        {(() => {
                          const labels: Record<string, string> = { planner: '规划', research: '检索', writer: '写作', reviewer: '评审', polisher: '润色' };
                          const items = (['planner', 'research', 'writer', 'reviewer', 'polisher'] as const)
                            .map((type) => {
                              const group = agents.filter((a) => a.agentType === type);
                              if (!group.length) return null;
                              const totalSec = group.reduce((s, a) => s + (a.durationMs || 0), 0) / 1000;
                              const hint = group.map((a) => `${a.agentName} ${(a.durationMs / 1000).toFixed(1)}s`).join('；');
                              return { label: `${labels[type]} Agent`, value: Math.round(totalSec * 10) / 10, sub: `${group.length}实例`, hint };
                            })
                            .filter(Boolean) as { label: string; value: number; sub: string; hint: string }[];
                          if (!items.length) return null;
                          return (
                            <div className="mb-3 rounded bg-white/60 dark:bg-slate-900/40 p-2">
                              <div className="text-[11px] font-medium text-teal-700 dark:text-teal-400 mb-1.5">各角色耗时汇总（秒，悬停看单实例）</div>
                              <HBar items={items} barHeight={6} />
                            </div>
                          );
                        })()}
                        {/* 按角色分组的执行链（2026 Supervisor-Worker 编排视图） */}
                        <div className="space-y-2">
                          {['planner', 'research', 'writer', 'reviewer', 'polisher'].map((type) => {
                            const group = agents.filter((a) => a.agentType === type);
                            if (group.length === 0) return null;
                            const labels: Record<string, string> = { planner: '规划 Agent', research: '检索 Agent', writer: '写作 Agent', reviewer: '评审 Agent', polisher: '润色 Agent' };
                            const colors: Record<string, string> = {
                              planner: 'border-teal-300 bg-teal-50 dark:bg-teal-900/30 dark:border-teal-700 border-l-[3px] border-l-teal-500',
                              research: 'border-sky-300 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-700 border-l-[3px] border-l-sky-500',
                              writer: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700 border-l-[3px] border-l-emerald-500',
                              reviewer: 'border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 border-l-[3px] border-l-amber-500',
                              polisher: 'border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 border-l-[3px] border-l-rose-500',
                            };
                            const allDone = group.every((a) => a.status === 'done');
                            const anyFail = group.some((a) => a.status === 'failed');
                            return (
                              <div key={type} className={`rounded-lg border p-2 ${colors[type]}`}>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full ${anyFail ? 'bg-rose-500' : allDone ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                                  <span className="font-medium text-[11px] text-slate-600 dark:text-slate-300">{labels[type]}</span>
                                  <span className="text-[10px] text-slate-400 ml-auto">{group.length} 个实例{group.some((a) => a.durationMs > 0) ? ` · 总耗时 ${(group.reduce((s, a) => s + a.durationMs, 0) / 1000).toFixed(1)}s` : ''}</span>
                                </div>
                                <div className="space-y-1">
                                  {group.map((a) => (
                                    <div key={a.id} className="flex items-center gap-2 bg-white/80 dark:bg-slate-900/60 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1">
                                      <span
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          a.status === 'done' ? 'bg-emerald-500' : a.status === 'failed' ? 'bg-rose-500' : 'bg-amber-400 animate-pulse'
                                        }`}
                                      />
                                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 w-24 shrink-0">{a.agentName}</span>
                                      <span className="text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate">{a.output || a.input}</span>
                                      <span className="text-slate-400 dark:text-slate-500 shrink-0">{a.status === 'done' ? `${(a.durationMs / 1000).toFixed(1)}s` : a.status === 'failed' ? `✗ ${(a.error || '').slice(0, 18)}` : '…'}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {/* 步骤时间线（品牌渐变徽章 + 纵向连接线，链条式阅读） */}
                <div className="space-y-0 mb-4">
                  {active.steps.map((s, i) => {
                    const tone = stepTone(s);
                    const isLast = i === active.steps.length - 1;
                    return (
                      <div key={s.key} className="flex items-start gap-2.5 relative">
                        {!isLast && <span className="absolute left-[11px] top-7 bottom-0 w-px bg-gradient-to-b from-teal-300/70 to-slate-200 dark:from-teal-700/60 dark:to-slate-700" />}
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 ${tone.bg}`}>{tone.icon}</div>
                        <div className="flex-1 min-w-0 pt-0.5 pb-4">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${s.status === 'pending' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>{STEP_LABELS[s.key] || s.label}</span>
                            {AGENT_MAP[s.key] && <Badge tone={AGENT_MAP[s.key].tone}>{AGENT_MAP[s.key].role}</Badge>}
                            {s.retryCount > 0 && <Badge tone="red">回炉 {s.retryCount} 次</Badge>}
                          </div>
                          {s.output && (
                            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-2 break-all">{s.output}</div>
                          )}
                        </div>
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
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-3">
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
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">论文标题</div>
            <Input value={editableOutline.title} onChange={(e) => setEditableOutline({ ...editableOutline, title: e.target.value })} />
            <div className="text-xs text-slate-400 dark:text-slate-500 my-2">
              章节（可直接编辑标题，删减行删除章节；确认后进入分章起草）
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {editableOutline.sections?.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm"
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
