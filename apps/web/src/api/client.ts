import type {
  Project, Doc, Reference, CitationRow, QualityReport, PipelineTask, PolishRecord, Outline,
  KnowledgeDoc, KnowledgeQueryResult, ExtractedPaper, EvidenceResult, DeepDiveResult, GapResult, AppSettings, SelfCheck,
  AgentRun, McpServerInfo, MemoryItem, ModelProvider, McpToolInfo, ResearchDesignResult, PaperComparisonResult, SimulatedReviewResult, IntentResult, CustomIntent, CustomPromptTool, PipelineStepConfig, QualityWeightItem,
} from '../types';

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  // 默认 60s 超时兜底：AI 网关限流/卡死时前端不无限等待（可被 opts.signal 覆盖）
  const timeoutMs = opts?.signal ? 0 : 60000;
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: opts?.signal ?? ctrl.signal,
      ...opts,
    });
    if (!res.ok) {
      let msg = `请求失败 (${res.status})`;
      try {
        const data = await res.json();
        msg = data.message || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('请求超时（AI 网关响应慢），请稍后重试');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  health: () => request<{ status: string; ai: { configured: boolean; model: string } }>('/api/health'),

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
    abstract: (id: string) => request<{ abstract: string; keywords: string[] }>(`/api/documents/${id}/abstract`, { method: 'POST' }),
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
  },

  references: {
    search: (query: string, limit = 8) =>
      request<Reference[]>(`/api/references/search`, { method: 'POST', body: JSON.stringify({ query, limit }) }),
    list: (projectId: string) => request<Reference[]>(`/api/references?projectId=${projectId}`),
    create: (projectId: string, hit: Partial<Reference> & { title: string }) =>
      request<Reference>('/api/references', { method: 'POST', body: JSON.stringify({ projectId, hit }) }),
    importMany: (projectId: string, hits: (Partial<Reference> & { title: string })[]) =>
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
  },

  knowledge: {
    list: (projectId: string) => request<KnowledgeDoc[]>(`/api/knowledge?projectId=${projectId}`),
    upload: (projectId: string, name: string, type: string, content: string) =>
      request<KnowledgeDoc>(`/api/knowledge/upload`, { method: 'POST', body: JSON.stringify({ projectId, name, type, content }) }),
    query: (projectId: string, question: string) =>
      request<KnowledgeQueryResult>(`/api/knowledge/query`, { method: 'POST', body: JSON.stringify({ projectId, question }) }),
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
  },

  pipeline: {
    create: (projectId: string, topic: string) =>
      request<PipelineTask>('/api/pipeline', { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    get: (id: string) => request<PipelineTask>(`/api/pipeline/${id}`),
    list: (projectId: string) => request<PipelineTask[]>(`/api/pipeline?projectId=${projectId}`),
    confirmOutline: (id: string, outline?: Outline) =>
      request<PipelineTask>(`/api/pipeline/${id}/confirm-outline`, { method: 'POST', body: JSON.stringify({ outline }) }),
    agents: (id: string) => request<AgentRun[]>(`/api/pipeline/${id}/agents`),
  },

  chat: {
    answer: (message: string, history: { role: string; content: string }[] = [], projectId?: string) =>
      request<{ answer: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ message, history, projectId }) }),
  },

  submission: {
    journals: (title: string, abstract: string, field: string) =>
      request<string>('/api/submission/journals', { method: 'POST', body: JSON.stringify({ title, abstract, field }) }),
    coverLetter: (title: string, abstract: string, journal: string) =>
      request<string>('/api/submission/cover-letter', { method: 'POST', body: JSON.stringify({ title, abstract, journal }) }),
    replyReview: (reviewComments: string, response: string) =>
      request<string>('/api/submission/reply-review', { method: 'POST', body: JSON.stringify({ reviewComments, response }) }),
  },
};

/** SSE 流式问答 */
export function streamChat(
  message: string,
  history: { role: string; content: string }[],
  onDelta: (text: string) => void,
  onDone: (full: string) => void,
  onError: (msg: string) => void,
  projectId?: string,
) {
  fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, projectId }),
  })
    .then(async (res) => {
      if (!res.ok || !res.body) throw new Error(`请求失败 (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
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
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload) as any;
            if (json.error) throw new Error(json.error);
            const delta = json.delta;
            if (delta) {
              full += delta;
              onDelta(full);
            }
          } catch {
            /* ignore */
          }
        }
      }
      onDone(full);
    })
    .catch((e) => onError(e.message || String(e)));
}
