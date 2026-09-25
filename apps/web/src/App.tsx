import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, FlaskConical, LayoutDashboard, MessageSquare, Plus, Send, Settings, Sparkles, Trash2, Workflow, BookMarked,
} from 'lucide-react';
import { api } from './api/client';
import type { Project } from './types';
import { Button, Input, Modal, Spinner, ErrorBox } from './components/ui';
import { DashboardPage } from './pages/DashboardPage';
import { WritingPage } from './pages/WritingPage';
import { LiteraturePage } from './pages/LiteraturePage';
import { PipelinePage } from './pages/PipelinePage';
import { QualityPage } from './pages/QualityPage';
import { ChatPage } from './pages/ChatPage';
import { SubmissionPage } from './pages/SubmissionPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { SettingsPage } from './pages/SettingsPage';

export type View =
  | 'dashboard'
  | 'writing'
  | 'literature'
  | 'pipeline'
  | 'quality'
  | 'chat'
  | 'submission'
  | 'knowledge'
  | 'settings';

const NAV: { key: View; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { key: 'writing', label: '论文写作', icon: BookOpen },
  { key: 'literature', label: '文献调研', icon: FlaskConical },
  { key: 'knowledge', label: '知识库', icon: BookMarked },
  { key: 'pipeline', label: '全自动流水线', icon: Workflow },
  { key: 'quality', label: '质量评分', icon: Sparkles },
  { key: 'chat', label: '科研问答', icon: MessageSquare },
  { key: 'submission', label: '投稿辅助', icon: Send },
  { key: 'settings', label: '设置', icon: Settings },
];

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameText, setRenameText] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.projects.list();
      setProjects(list);
      setCurrentProjectId((prev) => (list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api
      .health()
      .then((h) => setAiReady(h.ai.configured))
      .catch(() => setAiReady(false));
    loadProjects();
  }, [loadProjects]);

  const createProject = async () => {
    if (!newName.trim()) return;
    const p = await api.projects.create(newName.trim());
    setProjects((s) => [...s, p]);
    setCurrentProjectId(p.id);
    setNewName('');
    setShowNewProject(false);
  };

  const renameProject = async () => {
    if (!renaming || !renameText.trim()) return;
    const updated = await api.projects.update(renaming.id, { name: renameText.trim() });
    setProjects((s) => s.map((p) => (p.id === updated.id ? updated : p)));
    setRenaming(null);
  };

  const removeProject = async (id: string) => {
    if (!window.confirm('删除项目将同时删除其下所有文档、文献与流水线记录，确认？')) return;
    await api.projects.remove(id);
    setProjects((s) => s.filter((p) => p.id !== id));
    if (currentProjectId === id) setCurrentProjectId(null);
  };

  const currentProject = useMemo(() => projects.find((p) => p.id === currentProjectId) ?? null, [projects, currentProjectId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label="SciFlow 启动中…" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧项目栏 */}
      <aside className="w-60 shrink-0 bg-[#101b33] text-slate-300 flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-white font-bold text-lg tracking-wide">SciFlow</div>
          <div className="text-[11px] text-slate-400 mt-0.5">全自动 AI 科研助手</div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 px-2 py-2">研究项目</div>
          {projects.length === 0 && <div className="text-sm text-slate-500 px-2 py-4">暂无项目，点击下方创建</div>}
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => setCurrentProjectId(p.id)}
              className={`group rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                currentProjectId === p.id ? 'bg-indigo-600 text-white' : 'hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{p.name}</span>
                <span className="hidden group-hover:flex items-center gap-1">
                  <button
                    className="text-xs opacity-70 hover:opacity-100"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(p);
                      setRenameText(p.name);
                    }}
                  >
                    改
                  </button>
                  <button
                    className="text-xs opacity-70 hover:opacity-100"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProject(p.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-white/10">
          <Button variant="primary" className="w-full" onClick={() => setShowNewProject(true)}>
            <Plus size={16} /> 新建项目
          </Button>
          <div className={`mt-2 text-[11px] rounded px-2 py-1.5 ${aiReady ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
            {aiReady ? 'AI 服务已连接' : 'AI 未配置：.env 填 AI_API_KEY'}
          </div>
        </div>
      </aside>

      {/* 右侧主区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 flex items-center gap-1 overflow-x-auto shrink-0">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`flex items-center gap-1.5 px-3.5 py-3.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
                  view === n.key ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={15} />
                {n.label}
              </button>
            );
          })}
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4">
              <ErrorBox message={error} />
            </div>
          )}
          {!currentProject && view !== 'settings' ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="text-5xl">🔬</div>
              <div className="text-lg">请先创建一个研究项目</div>
              <Button onClick={() => setShowNewProject(true)}>
                <Plus size={16} /> 新建项目
              </Button>
            </div>
          ) : (
            <>
              {view === 'settings' && <SettingsPage />}
              {view === 'dashboard' && currentProject && <DashboardPage project={currentProject} onNavigate={setView} openDoc={(id) => { setSelectedDocId(id); setView('writing'); }} />}
              {view === 'writing' && currentProject && <WritingPage project={currentProject} initialDocId={selectedDocId} />}
              {view === 'literature' && currentProject && <LiteraturePage project={currentProject} />}
              {view === 'knowledge' && currentProject && <KnowledgePage project={currentProject} />}
              {view === 'pipeline' && currentProject && <PipelinePage project={currentProject} />}
              {view === 'quality' && currentProject && <QualityPage project={currentProject} />}
              {view === 'chat' && currentProject && <ChatPage project={currentProject} />}
              {view === 'submission' && currentProject && <SubmissionPage project={currentProject} />}
            </>
          )}
        </main>
      </div>

      {/* 新建项目弹窗 */}
      <Modal open={showNewProject} title="新建研究项目" onClose={() => setShowNewProject(false)} width="max-w-md">
        <Input placeholder="项目名称，如：图神经网络综述" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setShowNewProject(false)}>
            取消
          </Button>
          <Button onClick={createProject} disabled={!newName.trim()}>
            创建
          </Button>
        </div>
      </Modal>

      {/* 重命名弹窗 */}
      <Modal open={!!renaming} title="重命名项目" onClose={() => setRenaming(null)} width="max-w-md">
        <Input placeholder="新名称" value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenaming(null)}>
            取消
          </Button>
          <Button onClick={renameProject} disabled={!renameText.trim()}>
            保存
          </Button>
        </div>
      </Modal>
    </div>
  );
}
