import { Component, Suspense, lazy, useCallback, useContext, useEffect, useMemo, useState, createContext, type ReactNode } from 'react';
import { HashRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Brain, Beaker, FlaskConical, LayoutDashboard, Menu, MessageSquare, Plus, RefreshCw, Search, Send, Settings, Sparkles, Trash2, Workflow, BookMarked, ChevronRight, Command, Sun, Moon, Monitor, XCircle as XCircleIcon,
} from 'lucide-react';
import { api } from './api/client';
import type { KnowledgeDoc, Project, Reference } from './types';
import { Button, Input, Modal, Spinner, ErrorBox, ToastViewport, ConfirmDialog, type ToastItem, type ToastKind } from './components/ui';
// 路由级代码分割：所有页面懒加载（首屏只加载当前视图，大厂 SPA 标准）
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const WritingPage = lazy(() => import('./pages/WritingPage').then((m) => ({ default: m.WritingPage })));
const LiteraturePage = lazy(() => import('./pages/LiteraturePage').then((m) => ({ default: m.LiteraturePage })));
const PipelinePage = lazy(() => import('./pages/PipelinePage').then((m) => ({ default: m.PipelinePage })));
const QualityPage = lazy(() => import('./pages/QualityPage').then((m) => ({ default: m.QualityPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const SubmissionPage = lazy(() => import('./pages/SubmissionPage').then((m) => ({ default: m.SubmissionPage })));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage })));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const MemoryPage = lazy(() => import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })));
const SuspensePage = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div className="p-10 text-sm text-slate-400 flex items-center gap-2"><Spinner label="页面加载中…" /></div>}>{children}</Suspense>
);

export type View =
  | 'dashboard'
  | 'writing'
  | 'literature'
  | 'experiments'
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
      { key: 'experiments', label: '实验记录', icon: Beaker },
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
  experiments: '实验记录',
  knowledge: '知识库',
  memory: '记忆中心',
  pipeline: '全自动流水线',
  quality: '质量评分',
  chat: '科研问答',
  submission: '投稿辅助',
  settings: '设置',
};

/** 主题上下文（暗色模式，2026 桌面工具标配） */
export const ThemeContext = createContext<{ theme: 'light' | 'dark'; toggle: () => void }>({
  theme: 'light',
  toggle: () => undefined,
});

/** 全局 Toast 反馈上下文（页面级操作成功/失败提示） */
export const ToastContext = createContext<(kind: 'success' | 'error' | 'info', text: string) => void>(() => undefined);

function AppInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // 移动端抽屉侧栏
  const [writingDocTitle, setWritingDocTitle] = useState(''); // 任务6：写作页当前文档名（面包屑第三段）
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('sciflow-theme') as 'light' | 'dark') || 'light');

  // ---- 全局 Toast 反馈 ----
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((s) => [...s, { id, kind, text }]);
    window.setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 2600);
  }, []);

  // 路由化：pathname 决定当前视图（hash 路由，刷新/分享/深链不丢状态）；无效路径兜底工作台
  const rawView = (location.pathname.replace(/^\//, '') || 'dashboard') as View;
  const view: View = (['dashboard', 'writing', 'literature', 'experiments', 'pipeline', 'quality', 'chat', 'submission', 'knowledge', 'memory', 'settings'] as View[]).includes(rawView) ? rawView : 'dashboard';
  const selectedDocId = searchParams.get('doc');
  const setView = useCallback(
    (v: View) => {
      setSidebarOpen(false); // 移动端切换页面后自动收起抽屉
      navigate(`/${v}`);
    },
    [navigate],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('sciflow-theme', theme);
  }, [theme]);

  // 任务6：写作面包屑补文档层级——写作页且带 ?doc= 时拉取文档名；WritingPage 内部切文档会改 ?doc=，这里随参数变化刷新
  useEffect(() => {
    if (view === 'writing' && selectedDocId) {
      api.documents
        .get(selectedDocId)
        .then((d) => setWritingDocTitle(d.title || ''))
        .catch(() => setWritingDocTitle(''));
    } else {
      setWritingDocTitle('');
    }
  }, [view, selectedDocId]);

  const loadProjects = useCallback(async (attempt = 1) => {
    try {
      const list = await api.projects.list();
      setProjects(list);
      setCurrentProjectId((prev) => (list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null)));
      setError('');
    } catch (e: any) {
      // 初始化失败自动重试（后端冷启动场景）：最多 4 次，2s 间隔
      if (attempt < 4) {
        setTimeout(() => loadProjects(attempt + 1), 2000);
      } else {
        setError(e.message);
      }
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

  // 全局快捷键：⌘K 命令面板 / ⌘N 新建项目 / Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') {
        e.preventDefault();
        setCommandOpen((s) => !s);
      } else if (mod && k === 'n') {
        e.preventDefault(); // 阻止浏览器新窗口
        setCommandOpen(false);
        setShowNewProject(true);
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const createProject = async () => {
    if (!newName.trim()) return;
    const p = await api.projects.create(newName.trim());
    setProjects((s) => [...s, p]);
    setCurrentProjectId(p.id);
    setNewName('');
    setShowNewProject(false);
    setCommandOpen(false);
    toast('success', `项目「${p.name}」已创建`);
  };

  const renameProject = async () => {
    if (!renaming || !renameText.trim()) return;
    const updated = await api.projects.update(renaming.id, { name: renameText.trim() });
    setProjects((s) => s.map((p) => (p.id === updated.id ? updated : p)));
    setRenaming(null);
    toast('success', '项目已重命名');
  };

  const confirmDeleteProject = async () => {
    if (!deletingProject) return;
    await api.projects.remove(deletingProject.id);
    setProjects((s) => s.filter((p) => p.id !== deletingProject.id));
    if (currentProjectId === deletingProject.id) setCurrentProjectId(null);
    toast('info', '项目已删除');
    setDeletingProject(null);
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
    <ThemeContext.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }}>
      <ToastContext.Provider value={toast}>
        <div className="flex h-full overflow-hidden bg-slate-50 dark:bg-slate-950 dark:text-slate-100">
        {/* 移动端抽屉遮罩（md+ 隐藏） */}
        {sidebarOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />}
        {/* ============ 左侧边栏：Logo + 项目区 + 功能导航分组 + 底部设置（移动端抽屉 / 桌面常驻） ============ */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-200 ease-out md:static md:translate-x-0 md:shadow-none ${
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}>
          {/* Logo（品牌渐变徽标 + 内发光） */}
          <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg brand-logo text-white flex items-center justify-center text-[13px] font-bold tracking-tight">
              S
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                Sci<span className="brand-gradient-text">Flow</span>
              </div>
              <div className="text-[10px] text-slate-400 -mt-0.5">让科研从想法到成文</div>
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
                      className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-all duration-150 ${
                        view === n.key ? 'nav-active' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900'
                      }`}
                    >
                      <Icon size={14} className={view === n.key ? 'text-white/90' : 'text-slate-400 dark:text-slate-500'} />
                      {n.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 项目区（可滚动） */}
          <div className="flex-1 overflow-y-auto px-3 py-1 border-t border-slate-100 dark:border-slate-800">
            <div className="relative pt-2">
              <Search size={13} className="absolute left-2.5 top-[13px] text-slate-400" />
              <input
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 pl-8 pr-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:ring-1 focus:ring-slate-300 placeholder:text-slate-400"
                placeholder="搜索项目…"
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between px-2 pt-3 pb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">研究项目</span>
              <div className="flex items-center gap-1">
                <button className="text-slate-400 hover:text-slate-700" title="刷新项目列表" onClick={() => { setLoading(true); loadProjects(); }}>
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
                <button className="text-slate-400 hover:text-slate-700" title="新建项目" onClick={() => setShowNewProject(true)}>
                  <Plus size={13} />
                </button>
              </div>
            </div>
            {filteredProjects.length === 0 && <div className="text-xs text-slate-400 px-2 py-3">暂无项目，点击 + 创建</div>}
            {filteredProjects.map((p) => (
              <div
                key={p.id}
                onClick={() => { setCurrentProjectId(p.id); setSidebarOpen(false); }}
                className={`group relative rounded-md px-3 py-2 cursor-pointer text-sm transition-all duration-150 ${
                  currentProjectId === p.id ? 'bg-teal-50/80 text-teal-900 dark:bg-teal-900/25 dark:text-teal-100' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900'
                }`}
              >
                {currentProjectId === p.id && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full brand-logo" />}
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{p.name}</span>
                  <span className="hidden group-hover:flex items-center gap-1">
                    <button
                      className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
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
                        setDeletingProject(p);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 底部：设置 + AI 状态 + 主题切换 */}
          <div className="px-3 py-3 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setView('settings')}
              className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-all duration-150 ${
                view === 'settings' ? 'nav-active' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900'
              }`}
            >
              <Settings size={14} className={view === 'settings' ? 'text-white/90' : 'text-slate-400 dark:text-slate-500'} />
              设置
            </button>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] rounded-md px-2.5 py-1 bg-slate-50 dark:bg-slate-800">
              <button
                onClick={() => setCommandOpen(true)}
                className="flex-1 flex items-center gap-1.5 text-slate-500 dark:text-slate-300 hover:text-slate-700"
                title="命令面板 (Ctrl+K)"
              >
                <Command size={11} /> 命令面板
                <kbd className="ml-auto text-[9px] text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1">⌘K</kbd>
              </button>
              <button
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title={theme === 'light' ? '切换暗色模式' : '切换亮色模式'}
              >
                {theme === 'light' ? <Moon size={13} /> : <Sun size={13} />}
              </button>
            </div>
            <div className={`mt-2 flex items-center gap-1.5 text-[11px] rounded-md px-2.5 py-1 ${aiReady ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {aiReady ? 'AI 服务已连接' : 'AI 未配置'}
            </div>
          </div>
        </aside>

        {/* ============ 右侧主区 ============ */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 顶部面包屑：项目名 / 当前页（玻璃质感 header） */}
          <header className="glass-header border-b border-slate-200/60 dark:border-slate-800 px-3 sm:px-4 md:px-6 py-2.5 flex items-center gap-2 shrink-0">
            {/* 移动端抽屉开关 */}
            <button
              className="md:hidden p-1.5 -ml-1.5 rounded-md text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开导航菜单"
              title="打开导航"
            >
              <Menu size={18} />
            </button>
            {view === 'settings' ? (
              <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">设置</span>
            ) : currentProject ? (
              <div className="flex items-center gap-1.5 text-sm min-w-0">
                <span className="text-slate-400 truncate max-w-[120px] sm:max-w-[220px]">{currentProject.name}</span>
                <ChevronRight size={14} className="text-slate-300 shrink-0" />
                <span className="text-slate-900 dark:text-slate-100 font-medium whitespace-nowrap">{VIEW_LABELS[view]}</span>
                {/* 任务6：写作页补文档层级「{项目} > 论文写作 > {文档名}」 */}
                {view === 'writing' && writingDocTitle && (
                  <>
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                    <span className="text-slate-500 dark:text-slate-300 truncate max-w-[120px] sm:max-w-[260px]">{writingDocTitle}</span>
                  </>
                )}
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

          <main key={view} className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 page-in relative z-[1]">
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
                {view === 'settings' && <SuspensePage><SettingsPage /></SuspensePage>}
                {view === 'dashboard' && currentProject && <SuspensePage><DashboardPage project={currentProject} onNavigate={setView} openDoc={(id: string) => navigate(`/writing?doc=${id}`)} /></SuspensePage>}
                {view === 'writing' && currentProject && <SuspensePage><WritingPage project={currentProject} initialDocId={selectedDocId} /></SuspensePage>}
                {view === 'literature' && currentProject && <SuspensePage><LiteraturePage project={currentProject} /></SuspensePage>}
                {view === 'experiments' && currentProject && <SuspensePage><ExperimentsPage project={currentProject} /></SuspensePage>}
                {view === 'knowledge' && currentProject && <SuspensePage><KnowledgePage project={currentProject} /></SuspensePage>}
                {view === 'memory' && currentProject && <SuspensePage><MemoryPage /></SuspensePage>}
                {view === 'pipeline' && currentProject && <SuspensePage><PipelinePage project={currentProject} onOpenDoc={(id: string) => navigate(`/writing?doc=${id}`)} /></SuspensePage>}
                {view === 'quality' && currentProject && (
                  <Suspense fallback={<div className="p-8 text-sm text-slate-400">加载质量评分…</div>}>
                    <QualityPage project={currentProject} />
                  </Suspense>
                )}
                {view === 'chat' && currentProject && <SuspensePage><ChatPage project={currentProject} /></SuspensePage>}
                {view === 'submission' && currentProject && <SuspensePage><SubmissionPage project={currentProject} /></SuspensePage>}
              </>
            )}
          </main>
        </div>

        {/* ============ Cmd+K 命令面板（大厂标配：搜索式快速跳转） ============ */}
        {commandOpen && <CommandPalette projectId={currentProjectId} onClose={() => setCommandOpen(false)} onNavigate={(v) => setView(v)} onNewProject={() => { setCommandOpen(false); setShowNewProject(true); }} />}

        {/* 全局 Toast 反馈 */}
        <ToastViewport items={toasts} onDone={(id) => setToasts((s) => s.filter((t) => t.id !== id))} />

        {/* 新建项目弹窗 */}
        <Modal open={showNewProject} title="新建研究项目" onClose={() => setShowNewProject(false)} width="max-w-md">
          <Input placeholder="项目名称，如：图神经网络综述" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createProject()} autoFocus />
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

        {/* 删除项目确认弹窗（危险操作二次确认） */}
        <ConfirmDialog
          open={!!deletingProject}
          title="删除研究项目"
          description={`确定要删除「${deletingProject?.name ?? ''}」吗？项目下的所有文档、文献与流水线记录将被一并删除，且无法恢复。`}
          confirmText="删除"
          danger
          onConfirm={confirmDeleteProject}
          onClose={() => setDeletingProject(null)}
        />
        </div>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}

/** Cmd+K 命令面板：搜索导航项 + 快捷动作 + 内容搜索（文献/知识库） */
function CommandPalette({ onClose, onNavigate, onNewProject, projectId }: { onClose: () => void; onNavigate: (v: View) => void; onNewProject: () => void; projectId: string | null }) {
  const [q, setQ] = useState('');
  const { theme, toggle } = useContext(ThemeContext);
  const commands = useMemo(() => {
    const nav = NAV_GROUPS.flatMap((g) => g.items).map((n) => ({ id: `nav-${n.key}`, label: n.label, group: g(n.key), run: () => onNavigate(n.key) }));
    return [
      ...nav,
      { id: 'theme', label: theme === 'light' ? '切换到暗色模式' : '切换到亮色模式', group: '外观', run: toggle },
      { id: 'new-project', label: '新建研究项目', group: '项目', run: onNewProject },
    ];
  }, [onNavigate, onNewProject, theme, toggle]);

  const filtered = commands.filter((c) => !q.trim() || c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const [active, setActive] = useState(0);

  /* ---- 差距#18：内容搜索（文献 references.search + 知识库 list 前端过滤） ---- */
  // 后端未暴露 knowledge.search 单端，知识库退化为 list 后按文档名前端过滤；
  // 文献走 references.search（服务端检索）。两者并行，250ms 防抖。
  const [docHits, setDocHits] = useState<Reference[]>([]);
  const [kbHits, setKbHits] = useState<KnowledgeDoc[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const query = q.trim();
    setDocHits([]);
    setKbHits([]);
    if (!projectId || query.length < 2) {
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const [refRes, docRes] = await Promise.allSettled([
        api.references.search(query, 6, projectId),
        api.knowledge.list(projectId),
      ]);
      if (cancelled) return;
      const refs = refRes.status === 'fulfilled' ? refRes.value : [];
      const allDocs = docRes.status === 'fulfilled' ? docRes.value : [];
      const kb = allDocs.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
      setDocHits(refs);
      setKbHits(kb);
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, projectId]);

  const goTo = (v: View) => {
    onNavigate(v);
    onClose();
  };

  // 键盘导航：↑↓ 移动选中，Enter 执行（与底部提示一致）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      filtered[active].run();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Search size={15} className="text-slate-400" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
            placeholder="输入命令或页面名称…（Esc 关闭）"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="text-[10px] text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto py-2">
          {filtered.length === 0 && docHits.length === 0 && kbHits.length === 0 && !searching && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">没有匹配的命令或内容</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => { c.run(); onClose(); }}
              className={`w-full flex items-center justify-between px-4 py-2 text-left text-sm transition-colors ${i === active ? 'bg-teal-50 dark:bg-teal-900/25 text-teal-900 dark:text-teal-100 border-l-2 border-l-teal-500' : 'text-slate-600 dark:text-slate-300'}`}
            >
              <span>{c.label}</span>
              <span className="text-[11px] text-slate-400">{c.group}</span>
            </button>
          ))}

          {/* 差距#18：内容搜索结果（文献 / 知识库文档） */}
          {searching && <div className="px-4 py-2 text-[11px] text-slate-400">搜索内容…</div>}
          {!searching && q.trim().length >= 2 && (docHits.length > 0 || kbHits.length > 0) && (
            <>
              <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800 px-4 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                内容
              </div>
              {docHits.map((r) => (
                <button
                  key={`ref-${r.id}`}
                  onClick={() => goTo('literature')}
                  className="w-full flex items-center justify-between gap-2 px-4 py-1.5 text-left text-[13px] hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-slate-700 dark:text-slate-200 truncate block">{r.title}</span>
                    <span className="text-[11px] text-slate-400">{[r.venue, r.year].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-[10px] text-teal-500 shrink-0">文献 → 文献调研</span>
                </button>
              ))}
              {kbHits.map((d) => (
                <button
                  key={`kb-${d.id}`}
                  onClick={() => goTo('knowledge')}
                  className="w-full flex items-center justify-between gap-2 px-4 py-1.5 text-left text-[13px] hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-slate-700 dark:text-slate-200 truncate block">{d.name}</span>
                    <span className="text-[11px] text-slate-400">{d.type} · {d.chunkCount} 分块</span>
                  </span>
                  <span className="text-[10px] text-sky-500 shrink-0">知识库 → 知识库</span>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 flex items-center gap-3">
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">↑↓</kbd> 选择</span>
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">Enter</kbd> 执行</span>
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">⌘N</kbd> 新建项目</span>
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">⌘S</kbd> 写作页保存</span>
          <span className="ml-auto flex items-center gap-1"><Monitor size={11} /> SciFlow Command</span>
        </div>
      </div>
    </div>
  );
}

function g(key: View) {
  return NAV_GROUPS.find((grp) => grp.items.some((n) => n.key === key))?.label ?? '';
}

/** 全局错误边界：页面崩溃时显示友好提示而非白屏（健壮性兜底） */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8">
          <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center text-rose-500">
            <XCircleIcon size={22} />
          </div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">页面渲染出错</div>
          <div className="text-xs text-slate-400 dark:text-slate-500 max-w-md text-center break-all">{String(this.state.error?.message || this.state.error)}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </HashRouter>
  );
}
