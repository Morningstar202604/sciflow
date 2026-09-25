import { useEffect, useState } from 'react';
import { BookOpen, FileText, FlaskConical, Plus, Workflow } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project, Reference } from '../types';
import { Button, Card, Empty, Spinner, Badge, jsonText, SectionTitle } from '../components/ui';
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
    openDoc(doc.id);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <Card className="p-5 mb-5 bg-gradient-to-r from-indigo-600 to-sky-600 text-white border-0">
        <div className="text-lg font-semibold">{project.name}</div>
        <div className="text-sm opacity-80 mt-1">{project.description || '暂无项目描述'}</div>
        <div className="flex gap-4 mt-4 text-sm">
          <Badge tone="indigo">{docs.length} 篇文档</Badge>
          <Badge tone="blue">{refs.length} 条文献</Badge>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: '论文写作', desc: '大纲 / 起草 / 润色 / 翻译', icon: BookOpen, view: 'writing' as View },
          { label: '文献调研', desc: '多源检索 / 综述 / 文献库', icon: FlaskConical, view: 'literature' as View },
          { label: '全自动流水线', desc: '主题 → 初稿 → 评分 → 定稿', icon: Workflow, view: 'pipeline' as View },
          { label: '质量评分', desc: '7 维雷达评分与改进建议', icon: BookOpen, view: 'quality' as View },
        ].map((item) => (
          <Card key={item.label} className="p-4 cursor-pointer hover:border-indigo-400 hover:shadow-md transition-all" onClick={() => onNavigate(item.view)}>
            <item.icon size={18} className="text-indigo-600 mb-2" />
            <div className="font-medium text-slate-800 text-sm">{item.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{item.desc}</div>
          </Card>
        ))}
      </div>

      <SectionTitle
        extra={
          <div className="flex gap-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-52 outline-none focus:border-indigo-500"
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
        <Spinner label="加载中…" />
      ) : docs.length === 0 ? (
        <Empty text="暂无草稿，新建一篇开始写作，或到「全自动流水线」一键生成" />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {docs.map((d) => {
            const outline = jsonText<{ title: string; sections: { title: string }[] }>(d.outline, { title: '', sections: [] });
            return (
              <Card key={d.id} className="p-4 cursor-pointer hover:border-indigo-400 transition-colors" onClick={() => openDoc(d.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-slate-800 truncate">{d.title}</div>
                  <Badge tone={d.status === 'final' ? 'green' : d.status === 'polished' ? 'blue' : 'slate'}>
                    {d.status === 'final' ? '已定稿' : d.status === 'polished' ? '已润色' : '草稿'}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
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
