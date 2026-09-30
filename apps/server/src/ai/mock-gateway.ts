/**
 * 本地 Mock OpenAI 兼容网关（仅本机测试 / 演示用，与任何国外平台无关）
 * ============================================================================
 * 用途：在没有 AI_API_KEY、没有外网的本机环境下，让 SciFlow 的 AI 调用全部落到
 *       本进程内的一个零依赖 HTTP 服务上，从而跑通「Planner→Research→Writer→
 *       Reviewer→Polisher→renderCitations」全链路端到端验证与回归测试。
 *
 * 启用方式（由 ai.service.ts 读取，无需手动启动本服务）：
 *   AI_MOCK=1                        开启 mock 模式（默认端口 5099）
 *   AI_MOCK_PORT=5099                覆盖监听端口（可选）
 *
 * 覆盖的 prompt 形态（按 user message 特征关键词路由，全部为确定性响应）：
 *   - 研究计划/大纲（Planner / writeOutline）→ 含 objective/researchQuestions/sections 的大纲 JSON
 *   - ReAct 思考步                          → {action:"done", coverage:90} 直接收尾，避免死循环
 *   - 章节起草（Writer）                    → 中文论文章节 Markdown，带 [Ref:1]/[Ref:2] 占位以触发 renderCitations
 *   - 7 维评审（Reviewer）                  → scores 各维 84~90，总分≈87（≥80 阈值，不触发回炉）
 *   - 润色（Polisher）                      → {original, polished(原文原样), reason} 三段式 JSON
 *   - 翻译/摘要/综述/RAG 问答               → 对应形态的中文文本（带【来源N】/[Ref:N]）
 *   - 期刊匹配 / 审稿回复邮件解析           → 契约要求的包装 JSON（journals[] / suggestedStatus 枚举）
 *   - 连接测试                              → 固定回复「正常」
 *
 * 实现约束：
 *   - 零新增 npm 依赖，仅用 node 内置 http；零外部网络访问。
 *   - 同时支持一次性响应与 stream:true 的 SSE 分块响应（含 stream_options.include_usage 收尾块）。
 *   - 本服务仅监听 127.0.0.1，不对外暴露；进程退出时自动 close。
 * ============================================================================
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const DEFAULT_PORT = 5099;

let server: http.Server | null = null;
let startPromise: Promise<number> | null = null;

/** 是否处于 mock 模式（与 ai.service.ts 同一判定） */
export function isMockMode(): boolean {
  return process.env.AI_MOCK === '1';
}

function listenPort(): number {
  return Number(process.env.AI_MOCK_PORT || DEFAULT_PORT);
}

/**
 * 惰性启动 mock 网关（首次被 AI 调用时起，模块级单例，避免重复监听同一端口）。
 * 返回 baseUrl（含 /v1 前缀，与 OpenAI 兼容路径对齐：POST {baseUrl}/chat/completions）。
 */
export function startMockGateway(): string {
  const port = listenPort();
  if (!startPromise) {
    startPromise = new Promise<number>((resolve, reject) => {
      const srv = http.createServer(handleRequest);
      srv.on('error', (err) => {
        startPromise = null; // 允许下次重试（端口释放后）
        reject(err);
      });
      srv.listen(port, '127.0.0.1', () => {
        server = srv;
        console.log(`[mock-gateway] 本地 OpenAI 兼容 mock 服务已启动: http://127.0.0.1:${port}/v1 （仅本机测试用）`);
        resolve(port);
      });
      // 进程退出时优雅关闭，避免端口泄漏
      const close = () => {
        try {
          srv.close();
        } catch {
          /* ignore */
        }
      };
      process.once('exit', close);
    });
  }
  // 同步返回 baseUrl：listen 在极少数情况下尚未完成时，ai.service 已把 baseUrl 拼好；
  // 真正发请求是在首次 complete() 时（await acquireToken 之后），届时服务必然已 listen。
  void startPromise.catch((e) => console.error('[mock-gateway] 启动失败:', e?.message || e));
  return `http://127.0.0.1:${port}/v1`;
}

/** 仅供测试/进程退出时显式关闭 */
export function stopMockGateway(): void {
  if (server) {
    server.close();
    server = null;
    startPromise = null;
  }
}

// ---------------------------------------------------------------------------
// 请求处理
// ---------------------------------------------------------------------------

interface ChatReq {
  model?: string;
  messages?: { role: string; content: string }[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  // GET /v1/models —— OpenAI 兼容模型列表（listModels 用）
  if (req.method === 'GET' && /\/models\/?$/.test(url)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model', created: 0, owned_by: 'local-mock' }] }));
    return;
  }
  // POST /v1/chat/completions（兼容 /chat/completions）
  if (req.method === 'POST' && /\/chat\/completions\/?$/.test(url)) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed: ChatReq = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        parsed = {};
      }
      const prompt = lastUserContent(parsed.messages);
      const content = routeContent(prompt, parsed);
      if (parsed.stream) {
        writeSSE(res, content, !!parsed.stream_options?.include_usage);
      } else {
        writeJsonCompletion(res, content);
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `mock-gateway: no route for ${req.method} ${url}` } }));
}

function lastUserContent(messages?: { role: string; content: string }[]): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content) return String(messages[i].content);
  }
  return messages.length ? String(messages[messages.length - 1]?.content || '') : '';
}

// ---------------------------------------------------------------------------
// 响应序列化
// ---------------------------------------------------------------------------

function writeJsonCompletion(res: http.ServerResponse, content: string) {
  const completion = {
    id: `chatcmpl-mock-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: Math.max(1, Math.floor(content.length / 2)), total_tokens: 0 },
  };
  (completion.usage as any).total_tokens = completion.usage.prompt_tokens + completion.usage.completion_tokens;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(completion));
}

function writeSSE(res: http.ServerResponse, content: string, includeUsage: boolean) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `chatcmpl-mock-${randomUUID()}`;
  // 按 ~12 字一块切分模拟流式输出
  const chunkSize = 12;
  for (let i = 0; i < content.length; i += chunkSize) {
    const delta = content.slice(i, i + chunkSize);
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  if (includeUsage) {
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [], usage: { prompt_tokens: 12, completion_tokens: content.length, total_tokens: 12 + content.length } })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}

// ---------------------------------------------------------------------------
// 按 prompt 特征路由到确定性响应
// ---------------------------------------------------------------------------

function j(obj: unknown): string {
  return JSON.stringify(obj);
}

/** 从 POLISH prompt 中抽出「待处理文本」原文（保正文不被 mock 洗空） */
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

function routeContent(prompt: string, _req: ChatReq): string {
  // 0) 连接测试
  if (prompt.includes('请只回复两个字：正常')) return '正常';

  // 1) Planner 研究计划（PLAN_RESEARCH）
  if (prompt.includes('科研规划专家') && prompt.includes('researchQuestions')) {
    return j({
      objective: '围绕给定主题完成一篇系统性综述，覆盖方法演进、代表工作与应用前景。',
      researchQuestions: ['该主题的核心方法演进脉络是什么？', '代表性模型/工作有哪些共性与差异？', '在目标场景下的应用价值与局限如何？'],
      searchStrategy: { keywords: ['graph neural network', '图神经网络', '消息传递', 'node classification'], minPapers: 8, depth: 'overview' },
      draftingPlan: { sections: ['引言', '相关工作', '方法', '结果与讨论', '结论'], wordCount: 5000 },
      risks: ['公开文献时效性不足', '跨领域术语口径差异'],
    });
  }

  // 2) 论文大纲（WRITE_OUTLINE）
  if (prompt.includes('设计论文大纲') && prompt.includes('"sections"')) {
    return j({
      title: '图神经网络研究综述：从消息传递到几何深度学习',
      sections: [
        { title: '引言', subsections: ['研究背景', '本文贡献'] },
        { title: '相关工作', subsections: ['图表示学习', '消息传递范式'] },
        { title: '方法', subsections: ['GCN', 'GraphSAGE', 'GAT'] },
        { title: '结果与讨论', subsections: ['节点分类任务表现', '局限与挑战'] },
        { title: '结论', subsections: ['总结', '未来方向'] },
      ],
    });
  }

  // 3) ReAct 思考步 —— 一律 done，让研究循环快速收尾
  if (prompt.includes('自主研究执行器') && prompt.includes('action')) {
    return j({ thought: '信息已基本覆盖，进入综合写作阶段。', action: 'done', query: '', coverage: 90 });
  }

  // 4) Reflexion 反思
  if (prompt.includes('上一轮论文质量评审给出的问题如下')) {
    return j({ note: '补充近三年文献并规范引用', instructions: ['在相关工作节补充近三年代表性文献', '方法节补充数据集与超参数说明', '统一图表标注格式'] });
  }

  // 5) 章节起草（DRAFT_SECTION）—— 带 [Ref:N] 占位以触发 renderCitations
  if (prompt.includes('学术论文写作者') && prompt.includes('起草论文的一个章节')) {
    return [
      '近年来，图神经网络（Graph Neural Networks, GNN）在处理图结构数据方面取得了显著进展[Ref:1]。与传统深度学习模型只能处理规整张量不同，GNN 能够直接对节点与边构成的拓扑结构进行表示学习[Ref:2]。',
      '主流方法遵循消息传递范式：每个节点在每一轮中聚合其邻居的特征表示，经非线性变换后更新自身状态[Ref:1]。GCN 采用归一化邻域求和，GraphSAGE 通过采样与拼接提升可扩展性，GAT 则引入注意力机制自适应地衡量邻居重要性[Ref:2]。',
      '在节点分类任务上，上述模型均取得了优于传统方法的性能表现，但在大规模图与异质图场景下仍存在计算开销大、泛化性不足等挑战[Ref:1]。',
    ].join('\n\n');
  }

  // 6) 7 维评审（REVIEW_PAPER）—— 总分≈87，跨过 80 阈值不回炉
  if (prompt.includes('同行评审专家') && prompt.includes('"scores"')) {
    return j({
      scores: { literature: 88, logic: 86, citation: 90, language: 89, novelty: 84, figures: 85, format: 87 },
      feedback: '整体结构完整、论证链清晰；建议补充近三年文献的对比分析；图表标注可进一步统一规范。',
    });
  }

  // 7) 润色（POLISH）—— 原文原样回传，避免洗空正文
  if (prompt.includes('学术语言编辑') && prompt.includes('polished')) {
    const original = extractPolishText(prompt);
    return j({ original, polished: original, reason: 'mock 确定性润色：保留原意与专业术语，规范学术表达与段落衔接。' });
  }

  // 8) 学术翻译
  if (prompt.includes('学术翻译专家')) {
    return '图神经网络是一类强大的深度学习模型，专为图结构数据的表示学习而设计。';
  }

  // 9) 文献综述（SUMMARIZE_LITERATURE）
  if (prompt.includes('文献综述专家')) {
    return '现有研究沿「消息传递 → 注意力聚合 → 几何归纳偏置」三条主线推进图神经网络发展[Ref:1]。早期 GCN 通过谱域与空域近似建立可训练的图卷积算子[Ref:2]，后续工作在可扩展性与表达能力上持续改进。总体而言，方法已在节点分类、链接预测等任务上验证有效，但面向动态图与大规模图的高效推理仍是开放问题。';
  }

  // 10) 期刊推荐（文本）
  if (prompt.includes('推荐 3-5 个合适的投稿期刊')) {
    return '1. 《计算机学报》——方向高度匹配，审稿周期约 3-4 个月。\n2. 《软件学报》——中文核心，重视方法严谨性。\n3. IEEE TKDE（请以官方分区为准）——国际高被引期刊，适合完整方法与实验工作。';
  }

  // 11) Cover Letter
  if (prompt.includes('Cover Letter') || prompt.includes('投稿信')) {
    return 'Dear Editor,\n\nWe are pleased to submit our manuscript for consideration. This work presents a systematic survey of graph neural networks, covering message-passing paradigms, representative architectures, and applications. We believe it fits the journal\'s scope. The manuscript is original and has not been submitted elsewhere.\n\nSincerely,\nThe Authors';
  }

  // 12) 审稿回复信
  if (prompt.includes('审稿意见撰写回复信') || prompt.includes('Response to Reviewers') || prompt.includes('审稿意见')) {
    return 'Response to Reviewers:\n\nComment: The method section needs more detail.\nResponse: We have expanded Section 3 with dataset descriptions, hyperparameter settings and training protocols. Please see the revised manuscript.';
  }

  // 13) RAG 知识库问答（KNOWLEDGE_QA）
  if (prompt.includes('只依据') && prompt.includes('知识库资料')) {
    return '根据知识库资料：图神经网络通过消息传递机制聚合邻居节点特征，在节点分类任务上表现优异【来源1】。知识库未覆盖的方面：具体的工程实现细节与超参数取值。';
  }

  // 14) 文献结构化提取（EXTRACT_PAPER_TABLE）
  if (prompt.includes('文献列表做结构化提取') || prompt.includes('"papers"') && prompt.includes('"method"')) {
    return j({
      papers: [
        { ref: '1', title: 'Graph Neural Networks: A Review', year: 2020, method: '系统性综述', results: '梳理了 GCN/GraphSAGE/GAT 等代表模型', contribution: '统一消息传递视角', limitations: '缺少动态图讨论' },
      ],
    });
  }

  // 15) 证据综合（EVIDENCE_SYNTHESIS）
  if (prompt.includes('循证综述专家')) {
    return j({
      summary: '现有证据总体支持图神经网络在图结构任务上的有效性，结论一致性较好。',
      stances: [{ claim: '消息传递能提升节点表示质量', stance: '支持', count: 3, refs: ['1'], note: '多篇文献报告一致正向结果' }],
    });
  }

  // 16) 摘要 + 关键词
  if (prompt.includes('生成符合学术规范的摘要与关键词')) {
    return j({ abstract: '本文系统综述图神经网络的方法演进与应用现状。首先梳理消息传递范式，随后对比 GCN、GraphSAGE、GAT 等代表架构的优劣，最后讨论其在生物医药等领域的应用前景与开放挑战。', keywords: ['图神经网络', '消息传递', '节点分类'] });
  }

  // 17) 单篇文献深度精读
  if (prompt.includes('结构化深度解读') && prompt.includes('keyFindings')) {
    return j({
      title: 'Graph Neural Networks: A Review',
      oneLine: '系统综述图神经网络方法谱系',
      researchQuestion: '如何统一理解各类 GNN 的表示学习机制',
      motivation: 'GNN 已广泛应用但方法零散缺乏统一框架',
      method: '按消息传递范式分类对比代表模型',
      keyFindings: ['消息传递是主流统一范式', '注意力机制提升了邻域加权能力', '可扩展性仍是大规模图的瓶颈'],
      limitations: ['动态图讨论不足'],
      futureWork: '面向动态图与异质图的高效聚合算子',
      takeaway: '理解消息传递范式是掌握 GNN 的关键。',
    });
  }

  // 18) 研究缺口
  if (prompt.includes('尚未被充分研究') && prompt.includes('recommendedTopic')) {
    return j({
      gaps: [{ gap: '动态图场景下的高效消息传递聚合研究不足', evidence: '现有综述[Ref:1]以静态图为主', opportunity: '设计时序感知的邻居采样算子', feasibility: '中：公开动态图数据集可得' }],
      recommendedTopic: '面向动态图的时序感知消息传递图神经网络研究',
    });
  }

  // 19) 自动配图（GENERATE_FIGURES）
  if (prompt.includes('学术论文图表设计专家') && prompt.includes('"figures"')) {
    return j({
      figures: [
        { figureType: 'flowchart', title: '图 1：技术路线', caption: '从原始图数据到节点表示与下游任务的整体流程', mermaid: 'flowchart TD\nA[原始图数据]-->B[消息传递聚合]\nB-->C[节点表示]\nC-->D[节点分类]\nC-->E[链接预测]' },
      ],
    });
  }

  // 20) 情景记忆压缩
  if (prompt.includes('压缩为一条情景记忆') && prompt.includes('keywords')) {
    return j({ content: '完成图神经网络综述写作，采用引言-相关工作-方法-讨论-结论结构，质量评分优良', keywords: ['图神经网络', '综述', '消息传递'] });
  }

  // 21) 结构化期刊匹配（journalsMatch）
  if (prompt.includes('学术投稿顾问') && prompt.includes('"journals"')) {
    return j({
      journals: [
        { name: '计算机学报', score: 86, reason: '方向高度匹配，中文核心期刊', gap: '需补充与近三年方法的定量对比' },
        { name: '软件学报', score: 80, reason: '重视方法严谨性与实验完备性', gap: '建议补充消融实验' },
      ],
    });
  }

  // 22) 投稿邮件解析（parseSubmissionEmail）—— 返回合法枚举
  if (prompt.includes('阅读下面这封编辑部来稿邮件') && prompt.includes('suggestedStatus')) {
    return j({ suggestedStatus: 'minor_revision', confidence: 0.9, reason: '邮件明确小修后录用', date: '2026-10-31' });
  }

  // 23) 主题提炼（Planner 第一步 chat）
  if (prompt.includes('把以下研究主题提炼为一句可执行的研究题目')) {
    return extractTopic(prompt);
  }

  // 24) 兜底：通用科研问答
  return '这是本地 mock AI 网关的确定性回复：已收到请求。请检查 prompt 路由关键词是否需要补充。';
}
