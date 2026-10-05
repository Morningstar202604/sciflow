/**
 * 本地 Mock OpenAI 兼容网关（MSW 拦截器方案，替代 node:http 原始服务器）
 * ============================================================================
 * 用途：在没有 AI_API_KEY、没有外网的本机环境下，让 SciFlow 的 AI 调用全部落到
 *       MSW 拦截层上，从而跑通全链路端到端验证与回归测试。
 *
 * 启用方式：AI_MOCK=1（由 ai.service.ts 读取，调用 startMockGateway() 激活）
 *
 * 改进（vs 旧版 node:http 方案）：
 *   - 路由表是声明式 handler 数组，而非 24 分支 switch/case
 *   - handler 可独立测试、可复用
 *   - 不再需要原始 HTTP 服务器、端口管理、SSE 手工拼接
 *
 * 路由表覆盖的 prompt 形态与旧版完全一致（保持回归兼容）。
 * ============================================================================
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { randomUUID } from 'node:crypto';

/** 是否处于 mock 模式（与 ai.service.ts 同一判定） */
export function isMockMode(): boolean {
  return process.env.AI_MOCK === '1';
}

// ---------------------------------------------------------------------------
// 响应构造器（保持与旧版 OpenAI 兼容的响应结构）
// ---------------------------------------------------------------------------

function jsonCompletion(content: string) {
  return {
    id: `chatcmpl-mock-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: Math.max(1, Math.floor(content.length / 2)),
      total_tokens: 12 + Math.max(1, Math.floor(content.length / 2)),
    },
  };
}

function sseStream(content: string, includeUsage: boolean): Response {
  const id = `chatcmpl-mock-${randomUUID()}`;
  const chunkSize = 12;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // 按 ~12 字一块切分模拟流式输出
      for (let i = 0; i < content.length; i += chunkSize) {
        const delta = content.slice(i, i + chunkSize);
        const chunk = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      // 正文结束 chunk
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
      // usage 收尾块
      if (includeUsage) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [], usage: { prompt_tokens: 12, completion_tokens: content.length, total_tokens: 12 + content.length } })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ---------------------------------------------------------------------------
// prompt → 内容路由（声明式 handler 数组，替代旧版 24 分支 switch）
// ---------------------------------------------------------------------------

function j(obj: unknown): string {
  return JSON.stringify(obj);
}

/** 从 POLISH prompt 中抽出「待处理文本」原文 */
function extractPolishText(prompt: string): string {
  const start = prompt.indexOf('待处理文本：');
  if (start < 0) return prompt;
  let body = prompt.slice(start + '待处理文本：'.length);
  const endMarkers = ['\n\n请只输出一个合法', '\n\n要求：'];
  for (const m of endMarkers) {
    const idx = body.indexOf(m);
    if (idx >= 0) body = body.slice(0, idx);
  }
  return body.trim();
}

/** 从「提炼研究题目」prompt 中抽出主题原文 */
function extractTopic(prompt: string): string {
  const idx = prompt.lastIndexOf('\n');
  const t = idx >= 0 ? prompt.slice(idx + 1) : prompt;
  return t.trim() || '图神经网络在生物医药中的应用综述';
}

interface RouteRule {
  /** 匹配函数：从 user content 判断是否命中此规则 */
  matches: (prompt: string) => boolean;
  /** 返回响应内容字符串（会按请求 stream 标志自动封装为 SSE 或 JSON） */
  respond: (prompt: string) => string;
}

const ROUTE_TABLE: RouteRule[] = [
  // 0) 连接测试
  { matches: (p) => p.includes('请只回复两个字：正常'), respond: () => '正常' },
  // 1) Planner 研究计划
  { matches: (p) => p.includes('科研规划专家') && p.includes('researchQuestions'), respond: () => j({ objective: '围绕给定主题完成一篇系统性综述，覆盖方法演进、代表工作与应用前景。', researchQuestions: ['该主题的核心方法演进脉络是什么？', '代表性模型/工作有哪些共性与差异？', '在目标场景下的应用价值与局限如何？'], searchStrategy: { keywords: ['graph neural network', '图神经网络', '消息传递', 'node classification'], minPapers: 8, depth: 'overview' }, draftingPlan: { sections: ['引言', '相关工作', '方法', '结果与讨论', '结论'], wordCount: 5000 }, risks: ['公开文献时效性不足', '跨领域术语口径差异'] }) },
  // 2) 论文大纲
  { matches: (p) => p.includes('设计论文大纲') && p.includes('"sections"'), respond: () => j({ title: '图神经网络研究综述：从消息传递到几何深度学习', sections: [{ title: '引言', subsections: ['研究背景', '本文贡献'] }, { title: '相关工作', subsections: ['图表示学习', '消息传递范式'] }, { title: '方法', subsections: ['GCN', 'GraphSAGE', 'GAT'] }, { title: '结果与讨论', subsections: ['节点分类任务表现', '局限与挑战'] }, { title: '结论', subsections: ['总结', '未来方向'] }] }) },
  // 3) ReAct 思考步 —— 一律 done
  { matches: (p) => p.includes('自主研究执行器') && p.includes('action'), respond: () => j({ thought: '信息已基本覆盖，进入综合写作阶段。', action: 'done', query: '', coverage: 90 }) },
  // 4) Reflexion 反思
  { matches: (p) => p.includes('上一轮论文质量评审给出的问题如下'), respond: () => j({ note: '补充近三年文献并规范引用', instructions: ['在相关工作节补充近三年代表性文献', '方法节补充数据集与超参数说明', '统一图表标注格式'] }) },
  // 5) 章节起草
  { matches: (p) => p.includes('学术论文写作者') && p.includes('起草论文的一个章节'), respond: () => ['近年来，图神经网络（Graph Neural Networks, GNN）在处理图结构数据方面取得了显著进展[Ref:1]。与传统深度学习模型只能处理规整张量不同，GNN 能够直接对节点与边构成的拓扑结构进行表示学习[Ref:2]。', '主流方法遵循消息传递范式：每个节点在每一轮中聚合其邻居的特征表示，经非线性变换后更新自身状态[Ref:1]。GCN 采用归一化邻域求和，GraphSAGE 通过采样与拼接提升可扩展性，GAT 则引入注意力机制自适应地衡量邻居重要性[Ref:2]。', '在节点分类任务上，上述模型均取得了优于传统方法的性能表现，但在大规模图与异质图场景下仍存在计算开销大、泛化性不足等挑战[Ref:1]。'].join('\n\n') },
  // 6) 7 维评审
  { matches: (p) => p.includes('同行评审专家') && p.includes('"scores"'), respond: () => j({ scores: { literature: 88, logic: 86, citation: 90, language: 89, novelty: 84, figures: 85, format: 87 }, feedback: '整体结构完整、论证链清晰；建议补充近三年文献的对比分析；图表标注可进一步统一规范。' }) },
  // 7) 润色
  { matches: (p) => p.includes('学术语言编辑') && p.includes('polished'), respond: (p) => { const original = extractPolishText(p); return j({ original, polished: original, reason: 'mock 确定性润色：保留原意与专业术语，规范学术表达与段落衔接。' }); } },
  // 8) 学术翻译
  { matches: (p) => p.includes('学术翻译专家'), respond: () => '图神经网络是一类强大的深度学习模型，专为图结构数据的表示学习而设计。' },
  // 9) 文献综述
  { matches: (p) => p.includes('文献综述专家'), respond: () => '现有研究沿「消息传递 → 注意力聚合 → 几何归纳偏置」三条主线推进图神经网络发展[Ref:1]。早期 GCN 通过谱域与空域近似建立可训练的图卷积算子[Ref:2]，后续工作在可扩展性与表达能力上持续改进。总体而言，方法已在节点分类、链接预测等任务上验证有效，但面向动态图与大规模图的高效推理仍是开放问题。' },
  // 10) 期刊推荐
  { matches: (p) => p.includes('推荐 3-5 个合适的投稿期刊'), respond: () => '1. 《计算机学报》——方向高度匹配，审稿周期约 3-4 个月。\n2. 《软件学报》——中文核心，重视方法严谨性。\n3. IEEE TKDE（请以官方分区为准）——国际高被引期刊，适合完整方法与实验工作。' },
  // 11) Cover Letter
  { matches: (p) => p.includes('Cover Letter') || p.includes('投稿信'), respond: () => 'Dear Editor,\n\nWe are pleased to submit our manuscript for consideration. This work presents a systematic survey of graph neural networks, covering message-passing paradigms, representative architectures, and applications. We believe it fits the journal\'s scope. The manuscript is original and has not been submitted elsewhere.\n\nSincerely,\nThe Authors' },
  // 12) 审稿回复信
  { matches: (p) => p.includes('审稿意见撰写回复信') || p.includes('Response to Reviewers') || p.includes('审稿意见'), respond: () => 'Response to Reviewers:\n\nComment: The method section needs more detail.\nResponse: We have expanded Section 3 with dataset descriptions, hyperparameter settings and training protocols. Please see the revised manuscript.' },
  // 13) RAG 知识库问答
  { matches: (p) => p.includes('只依据') && p.includes('知识库资料'), respond: () => '根据知识库资料：图神经网络通过消息传递机制聚合邻居节点特征，在节点分类任务上表现优异【来源1】。知识库未覆盖的方面：具体的工程实现细节与超参数取值。' },
  // 14) 文献结构化提取
  { matches: (p) => p.includes('文献列表做结构化提取') || p.includes('结构化提取'), respond: () => j({ papers: [{ ref: '1', title: 'Graph Neural Networks: A Review', year: 2020, method: '系统性综述', results: '梳理了 GCN/GraphSAGE/GAT 等代表模型', contribution: '统一消息传递视角', limitations: '缺少动态图讨论' }] }) },
  // 15) 证据综合
  { matches: (p) => p.includes('循证综述专家'), respond: () => j({ summary: '现有证据总体支持图神经网络在图结构任务上的有效性，结论一致性较好。', stances: [{ claim: '消息传递能提升节点表示质量', stance: '支持', count: 3, refs: ['1'], note: '多篇文献报告一致正向结果' }] }) },
  // 16) 摘要 + 关键词
  { matches: (p) => p.includes('生成符合学术规范的摘要与关键词'), respond: () => j({ abstract: '本文系统综述图神经网络的方法演进与应用现状。首先梳理消息传递范式，随后对比 GCN、GraphSAGE、GAT 等代表架构的优劣，最后讨论其在生物医药等领域的应用前景与开放挑战。', keywords: ['图神经网络', '消息传递', '节点分类'] }) },
  // 17) 单篇文献深度精读
  { matches: (p) => p.includes('结构化深度解读') && p.includes('keyFindings'), respond: () => j({ title: 'Graph Neural Networks: A Review', oneLine: '系统综述图神经网络方法谱系', researchQuestion: '如何统一理解各类 GNN 的表示学习机制', motivation: 'GNN 已广泛应用但方法零散缺乏统一框架', method: '按消息传递范式分类对比代表模型', keyFindings: ['消息传递是主流统一范式', '注意力机制提升了邻域加权能力', '可扩展性仍是大规模图的瓶颈'], limitations: ['动态图讨论不足'], futureWork: '面向动态图与异质图的高效聚合算子', takeaway: '理解消息传递范式是掌握 GNN 的关键。' }) },
  // 18) 研究缺口
  { matches: (p) => p.includes('尚未被充分研究') && p.includes('recommendedTopic'), respond: () => j({ gaps: [{ gap: '动态图场景下的高效消息传递聚合研究不足', evidence: '现有综述[Ref:1]以静态图为主', opportunity: '设计时序感知的邻居采样算子', feasibility: '中：公开动态图数据集可得' }], recommendedTopic: '面向动态图的时序感知消息传递图神经网络研究' }) },
  // 19) 自动配图
  { matches: (p) => p.includes('学术论文图表设计专家') && p.includes('学术图表'), respond: () => j({ figures: [{ figureType: 'flowchart', title: '图 1：技术路线', caption: '从原始图数据到节点表示与下游任务的整体流程', mermaid: 'flowchart TD\nA[原始图数据]-->B[消息传递聚合]\nB-->C[节点表示]\nC-->D[节点分类]\nC-->E[链接预测]' }] }) },
  // 20) 情景记忆压缩
  { matches: (p) => p.includes('压缩为一条情景记忆') && p.includes('keywords'), respond: () => j({ content: '完成图神经网络综述写作，采用引言-相关工作-方法-讨论-结论结构，质量评分优良', keywords: ['图神经网络', '综述', '消息传递'] }) },
  // 21) 结构化期刊匹配
  { matches: (p) => p.includes('学术投稿顾问') && p.includes('"journals"'), respond: () => j({ journals: [{ name: '计算机学报', score: 86, reason: '方向高度匹配，中文核心期刊', gap: '需补充与近三年方法的定量对比' }, { name: '软件学报', score: 80, reason: '重视方法严谨性与实验完备性', gap: '建议补充消融实验' }] }) },
  // 22) 投稿邮件解析
  { matches: (p) => p.includes('阅读下面这封编辑部来稿邮件') && p.includes('suggestedStatus'), respond: () => j({ suggestedStatus: 'minor_revision', confidence: 0.9, reason: '邮件明确小修后录用', date: '2026-10-31' }) },
  // 23) 主题提炼
  { matches: (p) => p.includes('把以下研究主题提炼为一句可执行的研究题目'), respond: (p) => extractTopic(p) },
];

/** 默认兜底回复 */
const FALLBACK_REPLY = '这是本地 mock AI 网关的确定性回复：已收到请求。请检查 prompt 路由关键词是否需要补充。';

// ---------------------------------------------------------------------------
// MSW handler：从请求体中抽出最后一个 user message 并按路由表匹配
// ---------------------------------------------------------------------------

function getLastUserContent(body: any): string {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content) return String(messages[i].content);
  }
  return messages.length ? String(messages[messages.length - 1]?.content || '') : '';
}

const mockHandlers = [
  // GET /v1/models — 模型列表
  http.get('*/v1/models', () => {
    return HttpResponse.json({ object: 'list', data: [{ id: 'mock-model', object: 'model', created: 0, owned_by: 'local-mock' }] });
  }),
  // POST /v1/chat/completions — 统一入口（流式 + 非流式）
  http.post('*/v1/chat/completions', async ({ request }) => {
    let parsed: any = {};
    try {
      parsed = await request.json();
    } catch { /* 空体 */ }
    const prompt = getLastUserContent(parsed);
    // 路由匹配
    let content = FALLBACK_REPLY;
    for (const rule of ROUTE_TABLE) {
      if (rule.matches(prompt)) {
        content = rule.respond(prompt);
        break;
      }
    }
    if (parsed.stream) {
      // 返回 MSW 原生 Response（ReadableStream body）
      return new HttpResponse(sseStreamBody(content, !!parsed.stream_options?.include_usage), {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }
    return HttpResponse.json(jsonCompletion(content));
  }),
];

/** 构造 SSE stream body（Uint8Array ReadableStream） */
function sseStreamBody(content: string, includeUsage: boolean): ReadableStream<Uint8Array> {
  const id = `chatcmpl-mock-${randomUUID()}`;
  const encoder = new TextEncoder();
  const chunkSize = 12;
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < content.length; i += chunkSize) {
        const delta = content.slice(i, i + chunkSize);
        const chunk = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
      if (includeUsage) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [], usage: { prompt_tokens: 12, completion_tokens: content.length, total_tokens: 12 + content.length } })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// 公开 API（与旧版保持同名同签名，ai.service.ts 无需修改调用方式）
// ---------------------------------------------------------------------------

let server: ReturnType<typeof setupServer> | null = null;

/** 启动 MSW 拦截层（返回 baseUrl —— 无需端口，任何 URL 都会被 MSW 拦截） */
export function startMockGateway(): string {
  if (!server) {
    server = setupServer(...mockHandlers);
    server.listen({ onUnhandledRequest: 'bypass' });
    console.log('[mock-gateway] MSW mock 层已激活（拦截所有 fetch 请求，仅本机测试用）');
  }
  // 返回一个虚拟 baseUrl（MSW 拦截所有请求，URL 不影响路由）
  return process.env.AI_BASE_URL || 'http://mock.local/v1';
}

/** 关闭 MSW 拦截层 */
export function stopMockGateway(): void {
  if (server) {
    server.close();
    server = null;
  }
}

/** 测试用：动态追加路由规则（无需重启服务） */
export function addMockRoute(rule: RouteRule): void {
  ROUTE_TABLE.push(rule);
}

/** 测试用：清空自定义路由（保留内建规则） */
export function clearMockRoutes(): void {
  ROUTE_TABLE.splice(0, ROUTE_TABLE.length);
}
