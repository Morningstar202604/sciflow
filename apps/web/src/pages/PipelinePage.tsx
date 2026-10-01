import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Bot, Brain, Check, CircleDashed, Eye, Loader2, Plus, RotateCcw, Trash2, Workflow, Zap } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { AgentRun, Outline, PipelineStep, PipelineTask, Project, ReactTraceStep } from '../types';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Modal, Spinner, jsonText } from '../components/ui';
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

/**
 * 大纲模板（差距 #17）：前端常量，零 AI 依赖
 * 流水线后端 create 只收 topic 文本，故选中模板后把章节结构
 * 以纯文本形式追加到 topic 末尾，Planner/写作 Agent 自然遵循。
 * P2 扩展：自定义模板按项目隔离（后端项目 templates 字段，PATCH /api/projects/:id 持久化；
 *  首次进入时若后端为空且 localStorage 有旧值，一次性迁移写回后端并清本地）。
 * 内置预设只读；自定义模板可增/删/改，并可「一键套用」创建带章节骨架的草稿文档。
 */
interface OutlineTemplate {
  label: string;
  desc: string;
  sections: { title: string; hint: string }[];
}
const OUTLINE_TEMPLATES: Record<string, OutlineTemplate> = {
  review: {
    label: '综述（Review）',
    desc: '系统性梳理某领域研究现状，重综合轻实证',
    sections: [
      { title: '摘要', hint: '研究背景、范围与主要结论概览' },
      { title: '引言与背景', hint: '问题由来、综述范围与意义' },
      { title: '相关工作', hint: '按主题/方法脉络组织已有文献' },
      { title: '综述方法', hint: '检索策略、纳入与排除标准' },
      { title: '主题分类与讨论', hint: '横向归纳各流派观点与分歧' },
      { title: '挑战与未来方向', hint: '未解决问题与研究机会' },
      { title: '结论', hint: '总结领域图景与启示' },
    ],
  },
  imrad: {
    label: 'IMRaD 实证研究',
    desc: '实证论文标准四段式结构',
    sections: [
      { title: '摘要', hint: '目的、方法、结果、结论浓缩' },
      { title: '引言 Introduction', hint: '研究问题、假设与贡献' },
      { title: '方法 Methods', hint: '数据、实验设置与评价指标（可复现）' },
      { title: '结果 Results', hint: '客观呈现实验发现与图表' },
      { title: '讨论 Discussion', hint: '结果解读、与前人工作对比、局限' },
      { title: '结论 Conclusion', hint: '主要结论与未来工作' },
    ],
  },
  grant: {
    label: '基金提案',
    desc: '科研项目申请书/开题论证结构',
    sections: [
      { title: '立项依据', hint: '研究背景、国内外现状与科学问题' },
      { title: '研究目标与内容', hint: '总目标、具体目标与拟解决关键问题' },
      { title: '研究方案与技术路线', hint: '方法路径、实验设计与可行性分析' },
      { title: '预期成果与考核指标', hint: '论文/专利/数据集等可量化产出' },
      { title: '研究基础与工作条件', hint: '前期积累、团队与平台条件' },
      { title: '进度安排与经费预算', hint: '分年度计划与预算说明' },
    ],
  },
};

/* ---------------- 模板管理：内置预设（只读）+ 自定义（按项目后端 templates 字段） ---------------- */
interface ManagedTemplate {
  id: string;
  label: string;
  desc: string;
  builtin: boolean;
  sections: { title: string; hint: string }[];
}
/** 内置预设，不可删除/改名 */
const PRESET_TEMPLATES: ManagedTemplate[] = Object.entries(OUTLINE_TEMPLATES).map(([id, t]) => ({
  id,
  label: t.label,
  desc: t.desc,
  builtin: true,
  sections: t.sections,
}));
const tplStorageKey = (pid: string) => `sciflow:templates:${pid}`;

/** 容错解析模板数组（localStorage 旧值 / 后端 templates JSON 字符串共用） */
function parseTemplateArr(arr: unknown): ManagedTemplate[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((t: any) => t && typeof t === 'object')
    .map((t: any, i: number) => ({
      id: typeof t.id === 'string' && t.id ? t.id : `c_${Date.now()}_${i}`,
      label: String(t.label || '未命名模板'),
      desc: String(t.desc || ''),
      builtin: false,
      sections: Array.isArray(t.sections)
        ? t.sections
            .filter((s: any) => s && s.title)
            .map((s: any) => ({ title: String(s.title), hint: String(s.hint || '') }))
        : [],
    }));
}
/** 读取 localStorage 旧值（仅用于首次向后端一次性迁移；此后不再作为读源） */
function loadCustomTemplates(pid: string): ManagedTemplate[] {
  try {
    const raw = localStorage.getItem(tplStorageKey(pid));
    if (!raw) return [];
    return parseTemplateArr(JSON.parse(raw));
  } catch {
    return [];
  }
}
/** 序列化为后端 templates 字段存储形态（丢弃 builtin 标记，仅存自定义模板） */
function stripTemplates(list: ManagedTemplate[]) {
  return list.map(({ id, label, desc, sections }) => ({ id, label, desc, sections }));
}

export function PipelinePage({ project, onOpenDoc }: { project: Project; onOpenDoc?: (docId: string) => void }) {
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  /* —— 模板管理：自定义模板（按项目后端 templates 字段持久化）—— */
  const [customs, setCustoms] = useState<ManagedTemplate[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = 新增
  const [draft, setDraft] = useState<{ label: string; desc: string; sections: { title: string; hint: string }[] }>({
    label: '',
    desc: '',
    sections: [{ title: '', hint: '' }],
  });
  const [applying, setApplying] = useState(false);
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
  // 差距#9a：待删除的任务记录（二次确认后调用 DELETE /api/pipeline/:id；失败/中断任务同样可删）
  const [deletingTask, setDeletingTask] = useState<PipelineTask | null>(null);

  const active = tasks.find((t) => t.id === activeId) ?? null;

  /** 自定义模板按项目隔离加载：后端 templates 字段优先；后端为空且 localStorage 有旧值时一次性迁移写回后端 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let fromBackend: ManagedTemplate[] = [];
      try {
        if (project.templates) fromBackend = parseTemplateArr(JSON.parse(project.templates));
      } catch {
        fromBackend = [];
      }
      if (!cancelled) setCustoms(fromBackend);
      // 一次性迁移：后端为空但 localStorage 有旧自定义模板 → 写回后端并清本地
      if (fromBackend.length === 0) {
        const old = loadCustomTemplates(project.id);
        if (old.length > 0) {
          if (!cancelled) setCustoms(old);
          try {
            await api.projects.update(project.id, { templates: JSON.stringify(stripTemplates(old)) });
            try {
              localStorage.removeItem(tplStorageKey(project.id));
            } catch {
              /* 隐私模式清不掉也无妨 */
            }
          } catch {
            /* 迁移失败：保留本地 customs，下次进入再试 */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  /** 自定义模板持久化：写后端项目 templates 字段（PATCH /api/projects/:id），失败 toast 提示 */
  const persistCustomTemplates = async (list: ManagedTemplate[]) => {
    try {
      await api.projects.update(project.id, { templates: JSON.stringify(stripTemplates(list)) });
    } catch (e: any) {
      toast('error', '模板保存失败：' + (e?.message || '网络错误'));
    }
  };

  /** 全部模板 = 内置预设 + 当前项目自定义 */
  const templates: ManagedTemplate[] = [...PRESET_TEMPLATES, ...customs];
  const selected = templates.find((t) => t.id === templateId) || null;

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
      // 差距#17：选中大纲模板后，把章节结构以文本形式追加到主题，供 Planner/写作 Agent 遵循
      const tpl = selected;
      const finalTopic = tpl
        ? `${topic.trim()}\n\n[写作大纲模板：${tpl.label}] 请按以下章节结构组织全文：\n${tpl.sections.map((s, i) => `${i + 1}. ${s.title}——${s.hint}`).join('\n')}`
        : topic.trim();
      const t = await api.pipeline.create(project.id, finalTopic);
      toast('success', tpl ? `流水线已启动（模板：${tpl.label}），Agent 编排开始执行` : '流水线已启动，Agent 编排开始执行');
      setTasks((s) => [t, ...s]);
      setActiveId(t.id);
      setTopic('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  /* —— 模板管理：新增/编辑/删除（仅自定义模板；内置预设只读）—— */
  const openEditor = (id: string | null) => {
    setEditingId(id);
    if (id) {
      const t = customs.find((x) => x.id === id);
      setDraft(t ? { label: t.label, desc: t.desc, sections: t.sections.map((s) => ({ ...s })) } : { label: '', desc: '', sections: [{ title: '', hint: '' }] });
    } else {
      setDraft({ label: '', desc: '', sections: [{ title: '', hint: '' }] });
    }
    setEditorOpen(true);
  };

  const saveEditor = () => {
    const label = draft.label.trim();
    if (!label) {
      toast('error', '请填写模板名称');
      return;
    }
    const sections = draft.sections.filter((s) => s.title.trim());
    if (!sections.length) {
      toast('error', '请至少保留一个章节标题');
      return;
    }
    const record = { label, desc: draft.desc.trim(), sections };
    let next: ManagedTemplate[];
    if (editingId && customs.some((x) => x.id === editingId)) {
      next = customs.map((x) => (x.id === editingId ? { ...x, ...record } : x));
    } else {
      next = [...customs, { id: `c_${Date.now()}`, builtin: false, ...record }];
    }
    setCustoms(next);
    persistCustomTemplates(next);
    setEditorOpen(false);
    toast('success', editingId ? '模板已更新' : `已新增自定义模板「${label}」`);
  };

  const removeTemplate = (id: string) => {
    const t = customs.find((x) => x.id === id);
    if (!t) return;
    const next = customs.filter((x) => x.id !== id);
    setCustoms(next);
    persistCustomTemplates(next);
    if (templateId === id) setTemplateId('');
    toast('info', `已删除模板「${t.label}」`);
  };

  /** 一键套用：用模板章节标题创建带正文骨架的新草稿文档，并跳转写作页 */
  const applyTemplateToDoc = async (tpl: ManagedTemplate) => {
    if (!project?.id) {
      toast('error', '请先选择项目');
      return;
    }
    setApplying(true);
    setError('');
    try {
      const doc = await api.documents.create(project.id, `${tpl.label}草稿`);
      const skeleton = tpl.sections.map((s) => `## ${s.title}\n\n> ${s.hint}\n\n（在此撰写「${s.title}」章节正文…）\n`).join('\n');
      await api.documents.update(doc.id, { content: skeleton });
      toast('success', `已按「${tpl.label}」创建草稿，跳转写作页`);
      onOpenDoc?.(doc.id);
    } catch (e: any) {
      setError(e?.message || '创建草稿失败');
      toast('error', '创建草稿失败：' + (e?.message || '未知错误'));
    } finally {
      setApplying(false);
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

  /** 差距#9a：删除任务记录（DELETE /api/pipeline/:id）；删除后从列表移除并切换选中项 */
  const confirmDeleteTask = async () => {
    if (!deletingTask) return;
    try {
      await api.pipeline.remove(deletingTask.id);
      setTasks((s) => {
        const next = s.filter((t) => t.id !== deletingTask.id);
        if (activeId === deletingTask.id) setActiveId(next[0]?.id ?? null);
        return next;
      });
      toast('success', `已删除任务「${deletingTask.topic}」`);
    } catch (e: any) {
      toast('error', '删除失败：' + (e?.message || '未知错误'));
    } finally {
      setDeletingTask(null);
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

        {/* 差距#17：大纲模板选择（前端常量，零 AI）；P2：自定义模板管理 + 一键套用草稿 */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">大纲模板（可选）</div>
            <button
              onClick={() => setManageOpen(true)}
              className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline"
            >
              管理模板{customs.length ? `（${customs.length} 自定义）` : ''}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => setTemplateId((cur) => (cur === tpl.id ? '' : tpl.id))}
                title={tpl.desc}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                  templateId === tpl.id
                    ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/25 text-teal-700 dark:text-teal-200 border-l-[3px] border-l-teal-500'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-teal-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                {tpl.label}
                {!tpl.builtin && <span className="ml-1 text-[9px] opacity-60">自</span>}
              </button>
            ))}
          </div>
          {selected && (
            <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  已选择模板：<span className="font-medium text-teal-600 dark:text-teal-400">{selected.label}</span>
                  <span className="text-slate-400 dark:text-slate-500">（{selected.desc || selected.sections.length + ' 个章节'}）</span>
                </div>
                <Button
                  variant="success"
                  className="text-[11px] px-2 py-1 h-7"
                  loading={applying}
                  onClick={() => applyTemplateToDoc(selected)}
                  title="把模板章节标题作为正文骨架，创建一篇新草稿文档并跳转写作页"
                >
                  <Zap size={11} /> 一键套用为草稿
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {selected.sections.map((s, i) => (
                  <span key={i} className="inline-flex items-center rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-600 dark:text-slate-300" title={s.hint}>
                    {i + 1}. {s.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="输入研究主题，如：大语言模型在生物医学中的应用" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createTask()} />
          <Button onClick={createTask} disabled={creating || !topic.trim()} className="shrink-0">
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
                  <div className="flex items-center gap-2">
                    <Badge tone={statusText[active.status]?.tone || 'blue'}>{statusText[active.status]?.text || active.status}</Badge>
                    <button
                      onClick={() => setDeletingTask(active)}
                      title="删除此任务记录（失败/中断任务同样可删）"
                      className="text-slate-300 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
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

      {/* 模板管理弹窗：内置预设只读，自定义模板可编辑/删除/新增（按项目隔离存储） */}
      <Modal open={manageOpen} title="大纲模板管理" onClose={() => setManageOpen(false)} width="max-w-lg">
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  {t.label}
                  {t.builtin ? <Badge tone="slate">内置</Badge> : <Badge tone="teal">自定义</Badge>}
                </div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {t.sections.length} 章 · {t.desc || '自定义结构'}
                </div>
              </div>
              {t.builtin ? (
                <span className="text-[11px] text-slate-300 dark:text-slate-600 shrink-0">内置预设只读</span>
              ) : (
                <div className="flex gap-1 shrink-0">
                  <Button variant="outline" className="text-[11px] px-2 py-1 h-7" onClick={() => openEditor(t.id)}>
                    编辑
                  </Button>
                  <Button variant="danger" className="text-[11px] px-2 py-1 h-7" onClick={() => removeTemplate(t.id)}>
                    删除
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-between items-center">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">自定义模板按项目保存，仅本项目可见</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setManageOpen(false)}>
              关闭
            </Button>
            <Button
              onClick={() => {
                setManageOpen(false);
                openEditor(null);
              }}
            >
              <Plus size={13} /> 新增自定义模板
            </Button>
          </div>
        </div>
      </Modal>

      {/* 模板编辑器弹窗：名称 + 简介 + 章节列表（标题/说明）增删 */}
      <Modal open={editorOpen} title={editingId ? '编辑自定义模板' : '新增自定义模板'} onClose={() => setEditorOpen(false)} width="max-w-lg">
        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">模板名称</div>
            <Input
              placeholder="如：案例分析 / 综述（领域定制）"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">一句话说明（可选）</div>
            <Input placeholder="这个模板适合什么场景" value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">章节列表（标题 + 写作要点）</div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {draft.sections.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    className="w-2/5 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-sm bg-transparent"
                    placeholder="章节标题"
                    value={s.title}
                    onChange={(e) => {
                      const sections = [...draft.sections];
                      sections[i] = { ...s, title: e.target.value };
                      setDraft({ ...draft, sections });
                    }}
                  />
                  <input
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-sm bg-transparent"
                    placeholder="该章写作要点"
                    value={s.hint}
                    onChange={(e) => {
                      const sections = [...draft.sections];
                      sections[i] = { ...s, hint: e.target.value };
                      setDraft({ ...draft, sections });
                    }}
                  />
                  <Button
                    variant="danger"
                    className="px-2 py-1 text-xs shrink-0"
                    onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                className="text-xs w-full"
                onClick={() => setDraft({ ...draft, sections: [...draft.sections, { title: '', hint: '' }] })}
              >
                + 添加章节
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditorOpen(false)}>
            取消
          </Button>
          <Button onClick={saveEditor}>保存模板</Button>
        </div>
      </Modal>

      {/* 差距#9a：删除流水线任务记录二次确认 */}
      <ConfirmDialog
        open={!!deletingTask}
        title="删除流水线任务"
        description={deletingTask ? `确定要删除任务「${deletingTask.topic}」吗？其步骤/轨迹/Agent 执行记录将一并删除，且无法恢复。` : undefined}
        confirmText="删除"
        danger
        onConfirm={confirmDeleteTask}
        onClose={() => setDeletingTask(null)}
      />
    </div>
  );
}
