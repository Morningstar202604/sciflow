import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Brain, FlaskConical, LayoutDashboard, MessageSquare, Plus, Search, Send, Settings, Sparkles, Trash2, Workflow, BookMarked, ChevronRight,
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
import { MemoryPage } from './pages/MemoryPage';

export type View =
  | 'dashboard'
  | 'writing'
  | 'literature'
  | 'pipeline'
  | 'quality'
  | 'chat'
  | 'submission'
  | 'knowledge'
  | 'memory'
  | 'settings';

/** 功能导航分组（大厂式：按工作流分组，设置独立收纳到底部） */
const NAV_GROUPS: { label: string; items: { key: View; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: '研究工具',
    items: [
      { key: 'dashboard', label: '工作台', icon: LayoutDashboard },
      { key: 'writing', label: '论文写作', icon: BookOpen },
      { key: 'literature', label: '文献调研', icon: FlaskConical },
      { key: 'knowledge', label: '知识库', icon: BookMarked },
    ],
  },
  {
    label: '自动化',
    items: [
      { key: 'pipeline', label: '全自动流水线', icon: Workflow },
      { key: 'quality', label: '质量评分', icon: Sparkles },
      { key: 'memory', label: '记忆中心', icon: Brain },
    ],
  },
  {
    label: '辅助',
    items: [
      { key: 'chat', label: '科研问答', icon: MessageSquare },
      { key: 'submission', label: '投稿辅助', icon: Send },
    ],
  },
];

const VIEW_LABELS: Record<View, string> = {
  dashboard: '工作台',
  writing: '论文写作',
  literature: '文献调研',
  knowledge: '知识库',
  memory: '记忆中心',
  pipeline: '全自动流水线',
  quality: '质量评分',
  chat: '科研问答',
  submission: '投稿辅助',
  settings: '设置',
};

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
  const [projectQuery, setProjectQuery] = useState('');

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
  const filteredProjects = useMemo(
    () => (projectQuery.trim() ? projects.filter((p) => p.name.toLowerCase().includes(projectQuery.trim().toLowerCase())) : projects),
    [projects, projectQuery],
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label="SciFlow 启动中…" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-slate-50">
      {/* ============ 左侧边栏：Logo + 项目区 + 功能导航分组 + 底部设置 ============ */}
      <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Logo */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-[13px] font-bold tracking-tight">
            S
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-slate-900 tracking-tight">SciFlow</div>
            <div className="text-[10px] text-slate-400 -mt-0.5">全自动 AI 科研助手</div>
          </div>
        </div>

        {/* 功能导航分组（固定首屏，Linear 式） */}
        <div className="px-3 py-2">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="mb-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 px-2 py-1">{g.label}</div>
              {g.items.map((n) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.key}
                    onClick={() => setView(n.key)}
                    className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                      view === n.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon size={14} className={view === n.key ? 'text-teal-400' : 'text-slate-400'} />
                    {n.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* 项目区（可滚动） */}
        <div className="flex-1 overflow-y-auto px-3 py-1 border-t border-slate-100">
          <div className="relative pt-2">
            <Search size={13} className="absolute left-2.5 top-[13px] text-slate-400" />
            <input
              className="w-full rounded-lg bg-slate-100 pl-8 pr-2 py-1.5 text-xs text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-slate-300 placeholder:text-slate-400"
              placeholder="搜索项目…"
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between px-2 pt-3 pb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">研究项目</span>
            <button className="text-slate-400 hover:text-slate-700" title="新建项目" onClick={() => setShowNewProject(true)}>
              <Plus size={13} />
            </button>
          </div>
          {filteredProjects.length === 0 && <div className="text-xs text-slate-400 px-2 py-3">暂无项目，点击 + 创建</div>}
          {filteredProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => setCurrentProjectId(p.id)}
              className={`group relative rounded-md px-3 py-2 cursor-pointer text-sm transition-colors ${
                currentProjectId === p.id ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {currentProjectId === p.id && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded bg-teal-600" />}
              <div className="flex items-center justify-between gap-1">
                <span className="truncate">{p.name}</span>
                <span className="hidden group-hover:flex items-center gap-1">
                  <button
                    className="text-[11px] text-slate-400 hover:text-slate-700"
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
                    className="text-[11px] text-slate-400 hover:text-rose-600"
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

        {/* 底部：设置 + AI 状态 */}
        <div className="px-3 py-3 border-t border-slate-200">
          <button
            onClick={() => setView('settings')}
            className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
              view === 'settings' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Settings size={14} className={view === 'settings' ? 'text-teal-400' : 'text-slate-400'} />
            设置
          </button>
          <div className={`mt-2 flex items-center gap-1.5 text-[11px] rounded-md px-2.5 py-1 ${aiReady ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {aiReady ? 'AI 服务已连接' : 'AI 未配置'}
          </div>
        </div>
      </aside>

      {/* ============ 右侧主区 ============ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部面包屑：项目名 / 当前页 */}
        <header className="bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-2 shrink-0">
          {view === 'settings' ? (
            <span className="text-sm text-slate-700 font-medium">设置</span>
          ) : currentProject ? (
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <span className="text-slate-400 truncate max-w-[220px]">{currentProject.name}</span>
              <ChevronRight size={14} className="text-slate-300 shrink-0" />
              <span className="text-slate-900 font-medium whitespace-nowrap">{VIEW_LABELS[view]}</span>
            </div>
          ) : (
            <span className="text-sm text-slate-400">未选择项目</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {view !== 'settings' && currentProject && (
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => setShowNewProject(true)}>
                <Plus size={13} /> 新建项目
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4">
              <ErrorBox message={error} />
            </div>
          )}
          {!currentProject && view !== 'settings' ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="text-4xl">🔬</div>
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
              {view === 'memory' && currentProject && <MemoryPage />}
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
