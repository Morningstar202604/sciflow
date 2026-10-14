/**
 * Mock OpenAI 兼容 HTTP 网关（离线外部工具用）
 * =============================================
 * 服务内部的 mock 网关是 MSW 进程内拦截（不监听端口），外部工具（promptfoo 等）
 * 无法访问；本脚本复用 dist/ai/mock-gateway.js 的同一路由表与响应构造器，
 * 在 127.0.0.1 上暴露真实 HTTP 端点，保证「一份路由、两种出口」不漂移。
 *
 * 用法：pnpm --filter @sciflow/server build && node apps/server/scripts/mock-openai-http.mjs
 * 默认监听 127.0.0.1:5099（MOCK_HTTP_HOST / MOCK_HTTP_PORT 可覆盖）。
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let gw;
try {
  gw = require('../dist/ai/mock-gateway.js');
} catch (err) {
  console.error('[mock-http] 无法加载 mock 网关，请先运行 pnpm --filter @sciflow/server build：', err.message);
  process.exit(1);
}
const { mockContentFromBody, jsonCompletion, sseStreamBody, MOCK_MODELS_BODY } = gw;

const HOST = process.env.MOCK_HTTP_HOST || '127.0.0.1';
const PORT = Number(process.env.MOCK_HTTP_PORT || 5099);

function readJsonBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(MOCK_MODELS_BODY));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = await readJsonBody(req);
    const content = mockContentFromBody(body);
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      const reader = sseStreamBody(content, !!body.stream_options?.include_usage).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(jsonCompletion(content)));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error' } }));
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-http] OpenAI 兼容 mock 网关已启动: http://${HOST}:${PORT}/v1（复用 mock-gateway 路由表）`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
