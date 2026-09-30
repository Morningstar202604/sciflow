import { useEffect, useState } from 'react';
import { BookOpen, Beaker, FileText, FlaskConical, Gauge, Plus, Workflow, ArrowRight } from 'lucide-react';
import { api } from '../api/client';
import type { DashboardOverview, Doc, Project, Reference } from '../types';
import { Button, Card, Empty, Spinner, Skeleton, Badge, jsonText, SectionTitle } from '../components/ui';
import { Donut, HBar, MetricCard } from '../components/charts';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { View } from '../App';

export function DashboardPage({ project, onNavigate, openDoc }: {
  project: Project;
  onNavigate: (v: View) => void;
  openDoc: (id: string) => void;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [pipelineCount, setPipelineCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  /** 科研全链路总览：后端未就绪/失败时为 null，前端降级为小字提示，不白屏 */
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const toast = useContext(ToastContext);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.documents.list(project.id),
      api.references.list(project.id),
      api.knowledge.list(project.id).catch(() => [] as any[]),
      api.pipeline.list(project.id).catch(() => [] as any[]),
    ])
      .then(([d, r, k, p]) => {
        setDocs(d);
        setRefs(r);
        setKnowledgeCount(k.length);
        setPipelineCount(p.length);
      })
      .finally(() => setLoading(false));
    api.dashboard.overview().then(setOverview).catch(() => setOverview(null));
  }, [project.id]);

  const createDoc = async () => {
    if (!newTitle.trim()) return;
    const doc = await api.documents.create(project.id, newTitle.trim());
    setDocs((s) => [...s, doc]);
    setNewTitle('');
    toast('success', `草稿「${doc.title}」已创建`);
    openDoc(doc.id);
  };

  const entries = [
    { label: '论文写作', desc: '大纲 · 起草 · 润色 · 翻译', icon: BookOpen, view: 'writing' as View },
    { label: '文献调研', desc: '多源检索 · 综述 · 文献库', icon: FlaskConical, view: 'literature' as View },
    { label: '实验记录', desc: '本机 Python 沙箱 · 出图留存', icon: Beaker, view: 'experiments' as View },
    { label: '全自动流水线', desc: '主题 → 初稿 → 评分 → 定稿', icon: Workflow, view: 'pipeline' as View },
    { label: '质量评分', desc: '7 维雷达评分与改进建议', icon: Gauge, view: 'quality' as View },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      {/* 项目总览（大厂式：白底 + 数据统计，去渐变去重色） */}
      <Card className="p-4 sm:p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{project.name}</div>
            <div className="text-sm text-slate-400 dark:text-slate-500 mt-1">{project.description || '让科研从想法到成文，一站式完成文献、写作与投稿'}</div>
          </div>
        </div>
      </Card>

      {/* 项目数据概览：MetricCard 网格 + 草稿状态分布 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard label="论文草稿" value={docs.length} icon={<FileText size={14} />} hint={docs.length ? `${docs.length} 篇进行中` : '尚未创建草稿'} tone="brand" />
        <MetricCard label="参考文献" value={refs.length} icon={<BookOpen size={14} />} hint={refs.length ? '已入库文献' : '文献库为空'} tone="slate" />
        <MetricCard label="知识库资料" value={knowledgeCount} icon={<BookOpen size={14} />} hint="RAG 可问答资料数" tone="slate" />
        <MetricCard label="流水线任务" value={pipelineCount} icon={<Workflow size={14} />} hint="历史全自动任务数" tone="slate" />
      </div>

      {/* 科研全链路总览：待办计数 + 卡点跳转（后端未就绪时 catch 为 null，降级小字提示） */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">科研全链路</div>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">待办与卡点一览</span>
        </div>
        {overview === null ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">全链路总览暂不可用（接口未就绪或加载失败）。</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <MiniStat label="待确认大纲" value={overview.pendingOutline} tone="amber" onClick={() => onNavigate('pipeline')} />
              <MiniStat label="超期投稿" value={overview.overdueSubmissions.length} tone="red" onClick={() => onNavigate('submission')} />
              <MiniStat label="待处理审稿意见" value={overview.openReviewComments} tone="amber" />
              <MiniStat
                label="低分文档"
                value={overview.lowQualityDocs.length}
                tone="red"
                onClick={() => overview.lowQualityDocs[0] && openDoc(overview.lowQualityDocs[0].id)}
              />
            </div>
            {overview.overdueSubmissions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-rose-500 dark:text-rose-400">超期投稿</div>
                {overview.overdueSubmissions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-900/10 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{s.journalName} · {s.title}</div>
                      <div className="text-[11px] text-rose-500 dark:text-rose-400">已超 {s.overdueDays} 天 · 建议询问编辑部</div>
                    </div>
                    <Button variant="outline" className="text-xs shrink-0" onClick={() => onNavigate('submission')}>前往投稿</Button>
                  </div>
                ))}
              </div>
            )}
            {overview.lowQualityDocs.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-amber-500 dark:text-amber-400">低分文档</div>
                {overview.lowQualityDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{d.title}</div>
                      <div className="text-[11px] text-amber-500 dark:text-amber-400">总分 {d.score} · 建议润色</div>
                    </div>
                    <Button variant="outline" className="text-xs shrink-0" onClick={() => openDoc(d.id)}>前往写作</Button>
                  </div>
                ))}
              </div>
            )}
            {overview.pendingOutline === 0 && overview.overdueSubmissions.length === 0 && overview.lowQualityDocs.length === 0 && (
              <div className="text-xs text-slate-400 dark:text-slate-500">暂无卡点，全链路运转正常。</div>
            )}
          </div>
        )}
      </Card>

      {docs.length > 0 && (
        <Card className="p-4 mb-6">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">草稿状态分布</div>
          <Donut
            size={120}
            centerValue={String(docs.length)}
            centerLabel="草稿总数"
            segments={[
              { label: '草稿', value: docs.filter((d) => d.status === 'draft').length },
              { label: '评审中', value: docs.filter((d) => d.status === 'reviewing').length },
              { label: '已润色', value: docs.filter((d) => d.status === 'polished').length },
              { label: '已定稿', value: docs.filter((d) => d.status === 'final').length },
            ]}
          />
        </Card>
      )}

      {/* 功能入口（大厂式网格：图标底 + 名称 + 描述 + 箭头） */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
        {entries.map((item) => (
          <button
            key={item.label}
            onClick={() => onNavigate(item.view)}
            className="group card-lift text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-teal-300 dark:hover:border-teal-700"
          >
            <div className="flex items-start justify-between">
              <span className="w-9 h-9 rounded-lg bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:bg-gradient-to-br group-hover:from-teal-500 group-hover:to-sky-600 group-hover:text-white transition-all duration-200 group-hover:scale-110">
                <item.icon size={17} />
              </span>
              <ArrowRight size={14} className="text-slate-200 group-hover:text-teal-500 transition-all duration-200 group-hover:translate-x-0.5" />
            </div>
            <div className="font-medium text-sm text-slate-900 dark:text-slate-100 mt-2.5">{item.label}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.desc}</div>
          </button>
        ))}
      </div>

      <SectionTitle
        extra={
          <div className="flex gap-2 w-full sm:w-auto">
            <input
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm w-full sm:w-52 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50"
              placeholder="新建论文草稿标题"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createDoc()}
            />
            <Button onClick={createDoc} disabled={!newTitle.trim()}>
              <Plus size={15} /> 新建
            </Button>
          </div>
        }
      >
        论文草稿
      </SectionTitle>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-3">
          <Card className="p-4"><Skeleton lines={3} /></Card>
          <Card className="p-4"><Skeleton lines={3} /></Card>
        </div>
      ) : docs.length === 0 ? (
        <Empty text="暂无草稿，新建一篇开始写作，或到「全自动流水线」一键生成" />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {docs.map((d) => {
            const outline = jsonText<{ title: string; sections: { title: string }[] }>(d.outline, { title: '', sections: [] });
            const totalSec = outline.sections?.length || 0;
            const writtenSec = totalSec ? outline.sections.filter((s) => (d.content || '').includes(s.title)).length : 0;
            const wordK = Math.round((d.content?.length || 0) / 100) / 10;
            return (
              <Card key={d.id} className="p-4 cursor-pointer card-lift hover:border-teal-300 dark:hover:border-teal-700" onClick={() => openDoc(d.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{d.title}</div>
                  <Badge tone={d.status === 'final' ? 'green' : d.status === 'polished' ? 'blue' : 'slate'}>
                    {d.status === 'final' ? '已定稿' : d.status === 'polished' ? '已润色' : '草稿'}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 dark:text-slate-500">
                  <span className="flex items-center gap-1">
                    <FileText size={12} /> v{d.version}
                  </span>
                  <span>大纲 {totalSec} 章</span>
                  <span>{wordK}K 字</span>
                  <span className="ml-auto">{new Date(d.updatedAt).toLocaleString()}</span>
                </div>
                {totalSec > 0 && (
                  <div className="mt-2.5">
                    <HBar
                      barHeight={6}
                      items={[
                        {
                          label: '写作进度',
                          value: writtenSec,
                          max: totalSec,
                          sub: `${writtenSec}/${totalSec} 章`,
                          hint: `v${d.version} · 已写 ${writtenSec}/${totalSec} 章 · ${wordK}K 字`,
                        },
                      ]}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 全链路待办小卡：可点击跳转对应页面，不可点击时为纯展示 */
function MiniStat({ label, value, tone, onClick }: { label: string; value: number; tone: 'amber' | 'red' | 'slate'; onClick?: () => void }) {
  const toneCls = tone === 'red' ? 'text-rose-600 dark:text-rose-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200';
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-left ${onClick ? 'hover:border-teal-300 dark:hover:border-teal-700 cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`text-xl font-semibold leading-none ${toneCls}`}>{value}</div>
      <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{label}</div>
    </button>
  );
}
