import type {
  Project, Doc, Reference, ReferenceInput, CitationRow, QualityReport, PipelineTask, PolishRecord, Outline,
  KnowledgeDoc, KnowledgeQueryResult, KnowledgeDocDetail, KnowledgeSearchHit, ChatSource, RenderCitationsResult, DocVersionEntry, CiteStyle, ExtractedPaper, EvidenceResult, DeepDiveResult, GapResult, AppSettings, SelfCheck,
  AgentRun, McpServerInfo, MemoryItem, ModelProvider, McpToolInfo, ResearchDesignResult, PaperComparisonResult, SimulatedReviewResult, IntentResult, CustomIntent, CustomPromptTool, PipelineStepConfig, QualityWeightItem,
  ScreeningItem, ExtractionField, ExtractionTableResult, ReviewComment, Journal, JournalMatchResult, Experiment,
  SubmissionTrack, SubmissionStatus, ParseEmailResult, ReferenceGraph, BibtexImportResult, DashboardOverview,
} from '../types';

/** Narrow unknown error to readable message */
function extractErrMsg(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : String(e);
}

/**
 * API base（桌面端适配）：
 *  - Web 部署：未注入 → ''，全部走相对路径 /api（Vite 代理 / nginx 反代），行为与历史完全一致；
 *  - 桌面端（Electron）：preload 经 contextBridge 注入 window.sciflowDesktop.apiBase = http://127.0.0.1:<port>，
 *    页面从 file:// 加载时 fetch 需要绝对地址。
 */
declare global {
  interface Window {
    sciflowDesktop?: { apiBase?: string; openExternal?: (url: string) => void; version?: string };
  }
}
const API_BASE: string =
  typeof window !== 'undefined' && window.sciflowDesktop?.apiBase ? window.sciflowDesktop.apiBase : '';
/** 统一拼 API 地址：p 必须以 / 开头 */
const u = (p: string) => `${API_BASE}${p}`;

/** 友好错误转译：后端中文业务错误原样保留；英文/状态码/网络错误转为清晰中文提示 */
const statusText: Record<number, string> = {
  400: '请求参数有误，请检查后重试',
  401: '未授权访问，请检查服务配置',
  403: '没有操作权限',
  404: '请求的内容不存在或已被删除',
  409: '操作冲突，请刷新后重试',
  429: '请求过于频繁，请稍后再试',
  500: '服务内部错误，请稍后重试',
  502: '网关异常，请稍后重试',
  503: '服务暂时不可用，请稍后重试',
};
function friendlyError(raw: unknown, status?: number): string {
  if (typeof raw === 'string' && /[\u4e00-\u9fa5]/.test(raw)) return raw;
  if (status && statusText[status]) return statusText[status];
  return status ? `请求失败（${status}），请稍后重试` : '无法连接服务器，请确认服务已启动';
}

/** 当前登录令牌（AUTH_MODE=jwt 企业模式用；本地模式恒为空） */
export function getToken(): string | null {
  try {
    return localStorage.getItem('sciflow.token');
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem('sciflow.token', token);
    else localStorage.removeItem('sciflow.token');
  } catch {
    /* ignore */
  }
}
/** 401 统一处理：清 token + 通知全局登录门（AuthGate 监听） */
function onUnauthorized(): void {
  setToken(null);
  try {
    window.dispatchEvent(new Event('sciflow:unauthorized'));
  } catch {
    /* ignore */
  }
}

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  // 默认 60s 超时兜底：AI 网关限流/卡死时前端不无限等待（可被 opts.signal 覆盖）
  const timeoutMs = opts?.signal ? 0 : 60000;
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const token = getToken();
  try {
    const res = await fetch(u(url), {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts?.headers || {}),
      },
      signal: opts?.signal ?? ctrl.signal,
      ...opts,
    });
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized();
      let raw: unknown;
      try {
        const data = await res.json();
        raw = data.message ?? data.error;
      } catch {
        /* ignore */
      }
      throw new Error(friendlyError(raw, res.status));
    }
    return res.json() as Promise<T>;
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError') throw new Error('请求超时（AI 响应较慢），请稍后重试');
    if (e instanceof Error && /^[请求服务网络未授权没有操作]/.test(e.message)) throw e;
    throw new Error(friendlyError(undefined));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  health: () => request<{ status: string; time: number; uptime: number; authMode: string; db: boolean; desktop: boolean; ai: { configured: boolean; model: string } }>('/api/health'),

  auth: {
    register: (email: string, password: string, name?: string) =>
      request<{ token: string; user: { id: string; email: string; name: string; role: string } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
    login: (email: string, password: string) =>
      request<{ token: string; user: { id: string; email: string; name: string; role: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ id: string; email: string; name: string; role: string; createdAt: number }>('/api/auth/me'),
    logout: () => setToken(null),
  },

  projects: {
    list: () => request<Project[]>('/api/projects'),
    create: (name: string, description = '') =>
      request<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) }),
    update: (id: string, patch: Partial<Project>) =>
      request<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  },

  documents: {
    list: (projectId: string) => request<Doc[]>(`/api/documents?projectId=${projectId}`),
    get: (id: string) => request<Doc>(`/api/documents/${id}`),
    create: (projectId: string, title: string) =>
      request<Doc>('/api/documents', { method: 'POST', body: JSON.stringify({ projectId, title }) }),
    update: (id: string, patch: Partial<Doc>) =>
      request<Doc>(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: 'DELETE' }),
    outline: (id: string, topic?: string, summary = '') =>
      request<Outline>(`/api/documents/${id}/outline`, { method: 'POST', body: JSON.stringify({ topic, summary }) }),
    section: (id: string, sectionTitle: string) =>
      request<{ text: string }>(`/api/documents/${id}/section`, { method: 'POST', body: JSON.stringify({ sectionTitle }) }),
    polish: (id: string, text: string, mode: 'polish' | 'reduce') =>
      request<{ original: string; polished: string; reason: string }>(`/api/documents/${id}/polish`, {
        method: 'POST',
        body: JSON.stringify({ text, mode }),
      }),
    translate: (id: string, text: string, targetLang: 'zh' | 'en') =>
      request<{ translated: string }>(`/api/documents/${id}/translate`, {
        method: 'POST',
        body: JSON.stringify({ text, targetLang }),
      }),
    polishRecords: (id: string) => request<PolishRecord[]>(`/api/documents/${id}/polish-records`),
    citations: (id: string) => request<CitationRow[]>(`/api/documents/${id}/citations`),
    addCitation: (id: string, body: { referenceId: string; location?: string; context?: string }) =>
      request<CitationRow>(`/api/documents/${id}/citations`, { method: 'POST', body: JSON.stringify(body) }),
    removeCitation: (id: string, citationId: string) =>
      request<{ ok: boolean }>(`/api/documents/${id}/citations/${citationId}`, { method: 'DELETE' }),
    exportCitations: (id: string, format: string) =>
      request<string[]>(`/api/documents/${id}/export-citations?format=${format}`),
    exportMarkdown: (id: string) =>
      request<{ markdown: string; filename: string }>(`/api/documents/${id}/export`),
    exportDocx: (id: string) =>
      request<{ base64: string; filename: string }>(`/api/documents/${id}/export-docx`),
    abstract: (id: string) => request<{ abstract: string; keywords: string[] }>(`/api/documents/${id}/abstract`, { method: 'POST' }),
    /** 版本命名（PATCH versions JSON 内嵌 name，幂等覆盖；version 不存在/被历史上限淘汰返回 400），返回更新后的 versions 数组 */
    setVersionName: (id: string, version: number, name: string) =>
      request<DocVersionEntry[]>(`/api/documents/${id}/version-name`, { method: 'PATCH', body: JSON.stringify({ version, name }) }),
    /** 按样式渲染正文锚点+参考文献列表（纯函数预览，永不落库；前端确认后自行 PATCH content 覆盖） */
    renderCitations: (id: string, style: CiteStyle, dryRun = true) =>
      request<RenderCitationsResult>(`/api/documents/${id}/render-citations`, { method: 'POST', body: JSON.stringify({ style, dryRun }) }),
  },

  customization: {
    listIntents: () => request<CustomIntent[]>('/api/customization/intents'),
    createIntent: (body: { key: string; label: string; route: string; keywords: string[] }) =>
      request<CustomIntent>('/api/customization/intents', { method: 'POST', body: JSON.stringify(body) }),
    updateIntent: (id: string, patch: Partial<{ label: string; route: string; keywords: string[]; enabled: number }>) =>
      request<CustomIntent[]>(`/api/customization/intents/${id}`, { method: 'POST', body: JSON.stringify(patch) }),
    deleteIntent: (id: string) => request<{ ok: boolean }>(`/api/customization/intents/${id}`, { method: 'DELETE' }),
    listPrompts: () => request<CustomPromptTool[]>('/api/customization/prompts'),
    upsertPrompt: (toolKey: string, prompt: string, enabled = 1) =>
      request<CustomPromptTool[]>(`/api/customization/prompts/${toolKey}`, { method: 'POST', body: JSON.stringify({ prompt, enabled }) }),
    deletePrompt: (toolKey: string) => request<{ ok: boolean }>(`/api/customization/prompts/${toolKey}`, { method: 'DELETE' }),
    listPipelineSteps: () => request<PipelineStepConfig[]>('/api/customization/pipeline-steps'),
    updatePipelineStep: (stepKey: string, enabled: number) =>
      request<PipelineStepConfig[]>(`/api/customization/pipeline-steps/${stepKey}`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    resetPipelineSteps: () => request<{ ok: boolean }>('/api/customization/pipeline-steps', { method: 'DELETE' }),
    listQualityWeights: () => request<QualityWeightItem[]>('/api/customization/quality-weights'),
    setQualityWeights: (weights: Record<string, number>) =>
      request<QualityWeightItem[]>('/api/customization/quality-weights', { method: 'POST', body: JSON.stringify({ weights }) }),
    getJudgmentMode: () => request<{ mode: string }>('/api/customization/judgment-mode'),
    setJudgmentMode: (mode: string) => request<{ mode: string }>('/api/customization/judgment-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  },

  judgment: {
    intent: (message: string, context = '') =>
      request<IntentResult>(`/api/judgment/intent`, { method: 'POST', body: JSON.stringify({ message, context }) }),
  },

  research: {
    designReview: (idea: string, papers: { title: string; year?: number | null; venue?: string; abstract?: string }[]) =>
      request<ResearchDesignResult>(`/api/research/design-review`, { method: 'POST', body: JSON.stringify({ idea, papers }) }),
    comparison: (papers: { title: string; year?: number | null; venue?: string; abstract?: string }[]) =>
      request<PaperComparisonResult>(`/api/research/comparison`, { method: 'POST', body: JSON.stringify({ papers }) }),
    review: (title: string, content: string) =>
      request<SimulatedReviewResult>(`/api/research/review`, { method: 'POST', body: JSON.stringify({ title, content }) }),
    /* —— 审稿意见闭环 —— */
    reviewComments: (documentId: string) => request<ReviewComment[]>(`/api/research/review-comments?documentId=${documentId}`),
    addReviewComments: (documentId: string, comments: { reviewer: string; commentText: string; category?: string }[]) =>
      request<ReviewComment[]>('/api/research/review-comments', { method: 'POST', body: JSON.stringify({ documentId, comments }) }),
    updateReviewComment: (id: string, patch: Partial<{ status: string; responseText: string; category: string }>) =>
      request<ReviewComment>(`/api/research/review-comments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeReviewComment: (id: string) => request<{ ok: boolean }>(`/api/research/review-comments/${id}`, { method: 'DELETE' }),
    responseLetter: (documentId: string) =>
      request<{ letter: string }>('/api/research/response-letter', { method: 'POST', body: JSON.stringify({ documentId }) }),
  },

  references: {
    search: (query: string, limit = 8, projectId?: string) =>
      request<Reference[]>(`/api/references/search`, { method: 'POST', body: JSON.stringify({ query, limit, projectId }) }),
    list: (projectId: string) => request<Reference[]>(`/api/references?projectId=${projectId}`),
    create: (projectId: string, hit: ReferenceInput) =>
      request<Reference>('/api/references', { method: 'POST', body: JSON.stringify({ projectId, hit }) }),
    importMany: (projectId: string, hits: ReferenceInput[]) =>
      request<Reference[]>('/api/references/import', { method: 'POST', body: JSON.stringify({ projectId, hits }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/references/${id}`, { method: 'DELETE' }),
    summarize: (projectId: string, topic: string) =>
      request<string>(`/api/references/summarize`, { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    extract: (projectId: string) =>
      request<ExtractedPaper[]>(`/api/references/extract`, { method: 'POST', body: JSON.stringify({ projectId }) }),
    evidence: (projectId: string, question: string) =>
      request<EvidenceResult>(`/api/references/evidence`, { method: 'POST', body: JSON.stringify({ projectId, question }) }),
    deepDive: (projectId: string, refId: string) => request<DeepDiveResult>(`/api/references/deep-dive`, { method: 'POST', body: JSON.stringify({ projectId, refId }) }),
    gap: (projectId: string, topic: string) => request<GapResult>(`/api/references/gap`, { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    /* —— 科研高级功能：阅读状态 / 去重指纹 / 笔记（差距#11） —— */
    update: (id: string, patch: Partial<{ readingStatus: string; tags: string; notes: string | null }>) =>
      request<Reference>(`/api/references/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    /* —— 差距#20：批量 DOI 本地核验（合法置 cited / 非法不动 / 不存在进 skipped，纯本地格式校验不调外部） —— */
    verifyDois: (ids: string[]) =>
      request<{ valid: { id: string }[]; invalid: { id: string }[]; skipped: { id: string }[] }>(
        '/api/references/verify-dois',
        { method: 'POST', body: JSON.stringify({ ids }) },
      ),
    /* —— 系统综述：筛选队列 —— */
    screen: (projectId: string, referenceId: string, status: string, reason = '') =>
      request<ScreeningItem>('/api/references/screen', { method: 'POST', body: JSON.stringify({ projectId, referenceId, status, reason }) }),
    screenBulk: (projectId: string, referenceIds: string[], status: string, reason = '') =>
      request<{ ok: boolean; updated: number }>('/api/references/screen/bulk', { method: 'POST', body: JSON.stringify({ projectId, referenceIds, status, reason }) }),
    screenList: (projectId: string) => request<ScreeningItem[]>(`/api/references/screen?projectId=${projectId}`),
    /* —— 系统综述：文献编码抽取表 —— */
    extractionFields: (projectId: string) => request<ExtractionField[]>(`/api/references/extraction/fields?projectId=${projectId}`),
    addExtractionField: (projectId: string, key: string, label: string, kind = 'text', options: string[] = []) =>
      request<ExtractionField>('/api/references/extraction/fields', { method: 'POST', body: JSON.stringify({ projectId, key, label, kind, options }) }),
    removeExtractionField: (id: string) => request<{ ok: boolean }>(`/api/references/extraction/fields/${id}`, { method: 'DELETE' }),
    setExtractionValue: (fieldId: string, referenceId: string, value: string) =>
      request<{ ok: boolean }>('/api/references/extraction/values', { method: 'PUT', body: JSON.stringify({ fieldId, referenceId, value }) }),
    extractionTable: (projectId: string) => request<ExtractionTableResult>(`/api/references/extraction/table?projectId=${projectId}`),
    /* —— 引用网络图（共引 + 去重边聚合） —— */
    graph: (projectId: string) => request<ReferenceGraph>(`/api/references/graph?projectId=${projectId}`),
    /* —— BibTeX/RIS 导出（纯文本，前端 Blob 下载） —— */
    exportReferences: async (projectId: string, format: 'bibtex' | 'ris'): Promise<string> => {
      const res = await fetch(u(`/api/references/export?projectId=${encodeURIComponent(projectId)}&format=${format}`));
      if (!res.ok) throw new Error(friendlyError(undefined, res.status));
      return res.text();
    },
    /* —— BibTeX 导入（指纹去重，返回 imported/skipped） —— */
    importBibtex: (projectId: string, text: string) =>
      request<BibtexImportResult>('/api/references/import-bibtex', { method: 'POST', body: JSON.stringify({ projectId, text }) }),
    /* —— 引用打通：为某文档幂等添加引用（与 documents.citations 读路径分离写入口） —— */
    addCitation: (body: { documentId: string; referenceId: string; location?: string; context?: string }) =>
      request<{ id?: string; ok?: boolean }>('/api/references/citations', { method: 'POST', body: JSON.stringify(body) }),
  },

  dashboard: {
    /** 科研全链路总览（待办计数 + 卡点列表；接口未就绪时前端 catch 降级为小字提示） */
    overview: () => request<DashboardOverview>('/api/dashboard/overview'),
  },

  knowledge: {
    list: (projectId: string) => request<KnowledgeDoc[]>(`/api/knowledge?projectId=${projectId}`),
    upload: (projectId: string, name: string, type: string, content: string) =>
      request<KnowledgeDoc>(`/api/knowledge/upload`, { method: 'POST', body: JSON.stringify({ projectId, name, type, content }) }),
    query: (projectId: string, question: string) =>
      request<KnowledgeQueryResult>(`/api/knowledge/query`, { method: 'POST', body: JSON.stringify({ projectId, question }) }),
    /** 学习复盘取数：单文档全部分块正文（按 seq 升序）+ outline（Markdown 标题派生） */
    get: (id: string) => request<KnowledgeDocDetail>(`/api/knowledge/${id}`),
    /** 纯检索（不调 LLM，本地 BM25+向量）：返回命中文块，供来源卡片「引用到论文」/命令面板使用 */
    search: (projectId: string, query: string) =>
      request<KnowledgeSearchHit[]>(`/api/knowledge/search`, { method: 'POST', body: JSON.stringify({ projectId, query }) }),
    /** 文献库↔知识库打通（#5）：绑定/解除文献，referenceId 传 null 解除 */
    bind: (id: string, referenceId: string | null) =>
      request<KnowledgeDoc>(`/api/knowledge/${id}/bind`, { method: 'PATCH', body: JSON.stringify({ referenceId }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/knowledge/${id}`, { method: 'DELETE' }),
  },

  settings: {
    get: () => request<AppSettings>(`/api/settings`),
    check: () => request<SelfCheck>(`/api/settings/check`),
    testModel: (model: string) =>
      request<{ ok: boolean; reply: string; model: string; latencyMs: number }>(`/api/settings/test`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      }),
    listProviders: () => request<ModelProvider[]>(`/api/settings/providers`),
    saveProvider: (p: { id?: string; name: string; baseUrl: string; apiKey?: string; model: string }) =>
      request<{ ok: boolean; id: string }>(`/api/settings/providers`, { method: 'POST', body: JSON.stringify(p) }),
    removeProvider: (id: string) => request<{ ok: boolean }>(`/api/settings/providers/${id}`, { method: 'DELETE' }),
    activateProvider: (id: string) =>
      request<{ ok: boolean; active: string }>(`/api/settings/providers/${id}/activate`, { method: 'POST' }),
    listMcpServers: () => request<McpServerInfo[]>(`/api/settings/mcp-servers`),
    saveMcpServer: (p: { id?: string; name: string; url: string }) =>
      request<{ ok: boolean; id: string }>(`/api/settings/mcp-servers`, { method: 'POST', body: JSON.stringify(p) }),
    removeMcpServer: (id: string) => request<{ ok: boolean }>(`/api/settings/mcp-servers/${id}`, { method: 'DELETE' }),
  },

  usage: {
    summary: () =>
      request<{
        total: { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; avg_latency_ms: number; success_rate: number };
        byCaller: { caller: string; calls: number; total_tokens: number; success_rate: number }[];
        byDay: { day: string; calls: number; total_tokens: number }[];
      }>('/api/usage/summary'),
  },

  mcpExternal: {
    discover: (url: string) =>
      request<{ tools: { name?: string; description?: string }[] }>(`/api/mcp/external/discover`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
    call: (id: string, name: string, args: Record<string, any>) =>
      request<any>(`/api/mcp/external/${id}/call`, { method: 'POST', body: JSON.stringify({ name, arguments: args }) }),
  },

  memory: {
    list: (type?: string, q = '') => request<MemoryItem[]>(`/api/memory?type=${type || ''}&q=${encodeURIComponent(q)}`),
    add: (type: 'episodic' | 'procedural', content: string, projectId?: string, keywords: string[] = []) =>
      request<MemoryItem>('/api/memory', { method: 'POST', body: JSON.stringify({ type, content, projectId, keywords }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/memory/${id}`, { method: 'DELETE' }),
  },

  mcp: {
    info: () => request<{ protocol: string; version: string; name: string; tools: number }>('/api/mcp/info'),
    tools: () => request<{ tools: McpToolInfo[] }>('/api/mcp/tools'),
    call: (name: string, args: Record<string, any>) =>
      request<{ name: string; content?: { type: string; text: string }[]; isError?: boolean }>('/api/mcp/call', {
        method: 'POST',
        body: JSON.stringify({ name, arguments: args }),
      }),
  },

  quality: {
    review: (documentId: string, title: string, content: string) =>
      request<QualityReport>('/api/quality', { method: 'POST', body: JSON.stringify({ documentId, title, content }) }),
    history: (documentId: string) => request<QualityReport[]>(`/api/quality?documentId=${documentId}`),
    /** 最新一次质量评分（无记录时后端返回 null；接口未就绪时前端 catch 降级为空态） */
    latest: (documentId: string) =>
      request<QualityReport | null>(`/api/quality/latest?documentId=${encodeURIComponent(documentId)}`),
    /** 差距#7：把最新 quality_report.feedback 结构化为 review_comment（幂等，返回 created/existing） */
    exportComments: (documentId: string) =>
      request<{ created: number; existing: number }>(`/api/quality/export-comments?documentId=${encodeURIComponent(documentId)}`, { method: 'POST' }),
  },

  pipeline: {
    create: (projectId: string, topic: string) =>
      request<PipelineTask>('/api/pipeline', { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    get: (id: string) => request<PipelineTask>(`/api/pipeline/${id}`),
    list: (projectId: string) => request<PipelineTask[]>(`/api/pipeline?projectId=${projectId}`),
    confirmOutline: (id: string, outline?: Outline) =>
      request<PipelineTask>(`/api/pipeline/${id}/confirm-outline`, { method: 'POST', body: JSON.stringify({ outline }) }),
    agents: (id: string) => request<AgentRun[]>(`/api/pipeline/${id}/agents`),
    /** 差距#9a：删除任务记录（DELETE /api/pipeline/:id，后端已就绪；失败/interrupted 任务同样可删） */
    remove: (id: string) => request<{ ok: boolean }>(`/api/pipeline/${id}`, { method: 'DELETE' }),
  },

  chat: {
    answer: (message: string, history: { role: string; content: string }[] = [], projectId?: string) =>
      request<{ answer: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ message, history, projectId }) }),
  },

  experiments: {
    run: (body: { projectId: string; goal?: string; code: string; documentId?: string | null }) =>
      request<Experiment>('/api/experiments/run', { method: 'POST', body: JSON.stringify(body) }),
    list: (projectId: string) => request<Experiment[]>(`/api/experiments?projectId=${projectId}`),
    /** 按文档关联的实验（updatedAt 倒序；接口未就绪时前端 catch 降级为空态） */
    byDocument: (documentId: string) =>
      request<Experiment[]>(`/api/experiments/by-document/${encodeURIComponent(documentId)}`),
    get: (id: string) => request<Experiment>(`/api/experiments/${id}`),
    update: (id: string, patch: { goal?: string; conclusion?: string }) =>
      request<Experiment>(`/api/experiments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/experiments/${id}`, { method: 'DELETE' }),
  },

  submission: {
    journals: (title: string, abstract: string, field: string) =>
      request<string>('/api/submission/journals', { method: 'POST', body: JSON.stringify({ title, abstract, field }) }),
    coverLetter: (title: string, abstract: string, journal: string) =>
      request<string>('/api/submission/cover-letter', { method: 'POST', body: JSON.stringify({ title, abstract, journal }) }),
    replyReview: (reviewComments: string, response: string) =>
      request<string>('/api/submission/reply-review', { method: 'POST', body: JSON.stringify({ reviewComments, response }) }),
    /* —— 科研高级功能：期刊库 + 结构化匹配 —— */
    journalsMatch: (title: string, abstract: string) =>
      request<JournalMatchResult>('/api/submission/journals-match', { method: 'POST', body: JSON.stringify({ title, abstract }) }),
    listJournals: () => request<Journal[]>('/api/submission/journals'),
    addJournal: (j: Partial<Journal>) => request<Journal>('/api/submission/journals-lib', { method: 'POST', body: JSON.stringify(j) }),
    removeJournal: (id: string) => request<{ ok: boolean }>(`/api/submission/journals-lib/${id}`, { method: 'DELETE' }),
    /* —— 投稿流程状态跟踪 —— */
    trackSubmit: (body: {
      projectId: string;
      journalId?: string;
      journalName: string;
      documentId?: string;
      submittedAt?: number;
      currentStatus?: string;
      note?: string;
      previousSubmissionId?: string;
      revisionDeadline?: number | null;
    }) => request<SubmissionTrack>('/api/submission/track', { method: 'POST', body: JSON.stringify(body) }),
    listTracks: (projectId: string) => request<SubmissionTrack[]>(`/api/submission/track?projectId=${encodeURIComponent(projectId)}`),
    addTrackEvent: (id: string, body: { status: string; date?: number; note?: string }) =>
      request<SubmissionTrack>(`/api/submission/track/${id}/event`, { method: 'POST', body: JSON.stringify(body) }),
    parseEmail: (emailText: string, currentStatus: string) =>
      request<ParseEmailResult>('/api/submission/track/parse-email', { method: 'POST', body: JSON.stringify({ emailText, currentStatus }) }),
    updateTrack: (id: string, patch: Partial<{ notes: string; currentStatus: SubmissionStatus; revisionDeadline: number | null }>) =>
      request<SubmissionTrack>(`/api/submission/track/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeTrack: (id: string) => request<{ ok: boolean }>(`/api/submission/track/${id}`, { method: 'DELETE' }),
  },
};

/** SSE 流式问答（主流智能体范式版：停止/推理流/来源/用量事件回调）
 * 事件契约：正文增量 data: {"delta": string}，可同事件携带 "reasoning"；
 * 正文前可能先来 data: {"sources": [{docName,score,chunkText,chunkSeq,referenceId,referenceTitle}]}；结束前 data: {"usage": {...}}；
 * data: {"error": string}；末尾 data: [DONE]。
 * 返回 abort 函数：调用后立即断开连接，已收文本保留（onDone 以当前全文触发）。
 */
export function streamChat(opts: {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  projectId?: string;
  docContext?: string;
  model?: string;
  enableThinking?: boolean;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onSources?: (sources: ChatSource[]) => void;
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  onDone?: (full: string) => void;
  onError?: (msg: string) => void;
}): () => void {
  const ctrl = new AbortController();
  const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal;
  let full = '';
  const finish = () => opts.onDone?.(full);
  fetch(u('/api/chat/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({
      message: opts.message,
      history: opts.history || [],
      projectId: opts.projectId,
      docContext: opts.docContext,
      model: opts.model,
      enableThinking: opts.enableThinking,
    }),
    signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        let raw: unknown;
        try {
          const data = await res.json();
          raw = data.message ?? data.error;
        } catch {
          /* ignore */
        }
        throw new Error(friendlyError(raw, res.status));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let reasoning = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') {
            finish();
            return;
          }
          try {
            const json = JSON.parse(payload) as Record<string, unknown>;
            if (json.error) throw new Error(String(json.error));
            if (json.sources) {
              opts.onSources?.(json.sources as unknown as ChatSource[]);
              continue;
            }
            if (json.usage) {
              opts.onUsage?.(json.usage as unknown as { prompt_tokens: number; completion_tokens: number; total_tokens: number });
              continue;
            }
            if (typeof json.delta === 'string') {
              full += json.delta;
              opts.onDelta?.(full);
            }
            if (typeof json.reasoning === 'string') {
              reasoning += json.reasoning;
              opts.onReasoning?.(reasoning);
            }
          } catch (e: unknown) {
            const msg = extractErrMsg(e);
            if (msg) {
              opts.onError?.(friendlyError(/[\u4e00-\u9fa5]/.test(msg) ? msg : undefined));
              opts.onDone?.(full);
              return;
            }
            /* 忽略无法解析的行 */
          }
        }
      }
      finish();
    })
    .catch((e: unknown) => {
      // 用户主动停止：保留已收文本，正常收尾（不报错）
      if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError') {
        finish();
        return;
      }
      const msg = extractErrMsg(e);
      opts.onError?.(friendlyError(msg && /^[请求服务网络未授权没有操作]/.test(msg) ? msg : undefined));
    });
  return () => ctrl.abort();
}
