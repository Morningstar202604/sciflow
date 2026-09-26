import { useEffect, useState } from 'react';
import { BookOpen, FileText, FlaskConical, Gauge, Plus, Workflow, ArrowRight } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project, Reference } from '../types';
import { Button, Card, Empty, Spinner, Skeleton, Badge, jsonText, SectionTitle } from '../components/ui';
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
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const toast = useContext(ToastContext);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.documents.list(project.id), api.references.list(project.id)])
      .then(([d, r]) => {
        setDocs(d);
        setRefs(r);
      })
      .finally(() => setLoading(false));
  }, [project.id]);

  const createDoc = async () => {
    if (!newTitle.trim()) return;
    const doc = await api.documents.create(project.id, newTitle.trim());
    setDocs((s) => [...s, doc]);
    setNewTitle('');
    toast('success', `草稿「${doc.title}」已创建`);
    openDoc(doc.id);
  };

  const stats = [
    { label: '论文草稿', value: docs.length, icon: FileText, tone: 'text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800' },
    { label: '参考文献', value: refs.length, icon: BookOpen, tone: 'text-teal-700 bg-teal-50' },
  ];

  const entries = [
    { label: '论文写作', desc: '大纲 · 起草 · 润色 · 翻译', icon: BookOpen, view: 'writing' as View },
    { label: '文献调研', desc: '三源检索 · 综述 · 文献库', icon: FlaskConical, view: 'literature' as View },
    { label: '全自动流水线', desc: '主题 → 初稿 → 评分 → 定稿', icon: Workflow, view: 'pipeline' as View },
    { label: '质量评分', desc: '7 维雷达评分与改进建议', icon: Gauge, view: 'quality' as View },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      {/* 项目总览（大厂式：白底 + 数据统计，去渐变去重色） */}
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{project.name}</div>
            <div className="text-sm text-slate-400 dark:text-slate-500 mt-1">{project.description || '暂无项目描述'}</div>
          </div>
          <div className="flex gap-2 shrink-0">
            {stats.map((s) => (
              <div key={s.label} className="card-lift flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${s.tone}`}>
                  <s.icon size={14} />
                </span>
                <div className="leading-tight">
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 leading-none">{s.value}</div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

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
          <div className="flex gap-2">
            <input
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm w-52 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50"
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
                  <span>大纲 {outline.sections?.length || 0} 章</span>
                  <span>{Math.round(d.content?.length / 100) / 10 || 0}K 字</span>
                  <span className="ml-auto">{new Date(d.updatedAt).toLocaleString()}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
