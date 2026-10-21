import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * ChatSessionService 集成测试 —— 真实 in-memory SQLite + mock AiService。
 */

import { db } from '../db/database';
import { chatSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ChatSessionService } from './chat-session.service';

const TEST_PROJECT = 'test-proj-session-001';

describe('ChatSessionService', () => {
  let svc: ChatSessionService;

  beforeEach(() => {
    db.delete(chatSessions).where(eq(chatSessions.projectId, TEST_PROJECT)).run();
  });

  afterEach(() => {
    db.delete(chatSessions).where(eq(chatSessions.projectId, TEST_PROJECT)).run();
  });

  it('injectPastSummary 无历史时应返回空字符串', () => {
    svc = new ChatSessionService({ complete: async () => '' } as any);
    expect(svc.injectPastSummary(TEST_PROJECT)).toBe('');
  });

  it('injectPastSummary 有历史时应返回拼接的上下文', () => {
    const aiComplete = vi.fn(async () => '摘要A');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    // 插入一条历史
    db.insert(chatSessions).values({ id: 'h1', projectId: TEST_PROJECT, summary: '上次讨论了 CNN', messageCount: 4, totalTokens: 500, createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000 }).run();
    const ctx = svc.injectPastSummary(TEST_PROJECT);
    expect(ctx).toContain('CNN');
    expect(ctx).toContain('对话');
  });

  it('recordSummary 对消息数 < 2 的会话应直接跳过', async () => {
    const aiComplete = vi.fn(async () => '摘要');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [{ role: 'user', content: 'hi' }], 10);
    expect(aiComplete).not.toHaveBeenCalled();
  });

  it('recordSummary 成功 LLM 调用应写入 summary 到 DB', async () => {
    const aiComplete = vi.fn(async () => '研究问题：X方法对比。结论：Y效果最优。');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'user', content: '请帮我查文献' },
      { role: 'assistant', content: '好的，我帮你检索了...' },
    ], 200);
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows.length).toBe(1);
    expect(rows[0].summary).toContain('X方法对比');
    expect(rows[0].totalTokens).toBe(200);
  });

  it('recordSummary 应将 system 消息排除在 messageCount 与 prompt 之外', async () => {
    const aiComplete = vi.fn(async () => '摘要内容');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'system', content: '你是科研助手' },
      { role: 'user', content: '查文献' },
      { role: 'assistant', content: '已检索' },
    ], 150);
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows.length).toBe(1);
    expect(aiComplete.mock.calls[0][0][0].content).not.toContain('你是科研助手');
    expect(rows[0].messageCount).toBe(2);
  });

  it('recordSummary LLM 失败时应 fallback 截取首条 user 内容', async () => {
    const aiComplete = vi.fn(async () => { throw new Error('LLM 不可用'); });
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'user', content: '关于深度学习的文献调研' },
      { role: 'assistant', content: '检索完成' },
    ], 120);
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows.length).toBe(1);
    expect(rows[0].summary).toContain('深度学习');
  });

  it('listSummaries 应按 createdAt 倒序返回且 limit 生效', () => {
    // 原用例只 db.select 后断言行数，从不调用被测方法——orderBy(desc) 被改成 asc 也全绿。
    for (let i = 1; i <= 6; i++) {
      db.insert(chatSessions)
        .values({ id: `s${i}`, projectId: TEST_PROJECT, summary: `m${i}`, messageCount: 2, totalTokens: 100, createdAt: i * 1000, updatedAt: i * 1000 })
        .run();
    }
    svc = new ChatSessionService({ complete: async () => '' } as any);
    const rows = svc.listSummaries(TEST_PROJECT, 5);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.id)).toEqual(['s6', 's5', 's4', 's3', 's2']);
    expect(svc.listSummaries(TEST_PROJECT, 2).map((r) => r.id)).toEqual(['s6', 's5']);
    // 项目隔离：其他项目的摘要不能混进来
    expect(svc.listSummaries('other-project')).toHaveLength(0);
  });
});
