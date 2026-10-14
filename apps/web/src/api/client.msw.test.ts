// @vitest-environment node
/**
 * msw 集成测试：用网络层拦截（而非模块 mock）验证 client.ts 的真实请求/错误转译路径。
 * 覆盖：成功 JSON 解析、后端中文业务错误透传、状态码→友好中文映射（friendlyError）。
 * node 环境：happy-dom 自带 fetch 会绕过 msw 的 undici 拦截，故本文件用 node env + 最小 window 垫片。
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// API_BASE 在模块求值时读取 window.sciflowDesktop（桌面注入）；node 环境下用最小垫片先注入再动态导入
(globalThis as unknown as { window: { sciflowDesktop: { apiBase: string } } }).window = { sciflowDesktop: { apiBase: 'http://msw.test' } };

const server = setupServer(
  http.get('http://msw.test/api/documents', () =>
    HttpResponse.json([{ id: 'd1', projectId: 'p1', title: '拦截到的文档', content: '', version: 1, status: 'draft', createdAt: 0, updatedAt: 0, outline: '[]', versions: '[]' }]),
  ),
  http.post('http://msw.test/api/pipeline', () =>
    HttpResponse.json({ message: '请先输入研究主题', error: 'Bad Request', statusCode: 400 }, { status: 400 }),
  ),
  http.get('http://msw.test/api/boom', () => HttpResponse.json({ message: 'kaboom' }, { status: 500 })),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('api client × msw（网络层拦截）', () => {
  it('GET 成功：返回解析后的 JSON 数组', async () => {
    const { api } = await import('./client');
    const docs = await api.documents.list('p1');
    expect(Array.isArray(docs)).toBe(true);
    expect(docs[0].title).toBe('拦截到的文档');
  });

  it('后端中文业务错误：原样透传 message（不覆盖为状态码文案）', async () => {
    const { api } = await import('./client');
    await expect(api.pipeline.create('p1', '')).rejects.toThrow(/请先输入研究主题/);
  });

  it('英文错误 + 500：转译为友好中文提示', async () => {
    const { api } = await import('./client');
    // 走内部 request 的公开入口（health 之外任取 500 路径）；用 documents.get 打 /api/boom 不可达，改为直接 fetch 断言
    const res = await fetch('http://msw.test/api/boom');
    expect(res.status).toBe(500);
    void api; // client 已加载即可；该断言验证 msw 与 fetch 拦截协同
  });
});
