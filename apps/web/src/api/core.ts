import type { ChatSource } from '../types';

/** Narrow unknown error to readable message */
export function extractErrMsg(e: unknown): string {
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
export const u = (p: string) => `${API_BASE}${p}`;

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
export function friendlyError(raw: unknown, status?: number): string {
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

export async function request<T>(url: string, opts?: RequestInit): Promise<T> {
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
