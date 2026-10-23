import { expect, test } from '@playwright/test';

/**
 * 对话工作台端到端冒烟（真实交互，不是「页面能打开」）。
 *
 * 历史问题：旧用例只 goto + 断言 #root 可见，且用 `onboarding.or(workspace)` 二选一、
 * `.catch(() => false)` 吞错——把后端整个杀掉依然 passed。
 * 现在必须走完：创建项目 → 进入工作台 → 发送消息 → 等到助手回复出现。
 */

const API = process.env.E2E_API || 'http://127.0.0.1:3000';

test('工作台真实链路：建项目 → 发消息 → 收到助手回复', async ({ page, request }) => {
  // 后端必须真的可达（前置条件失败要显式红，而不是被断言跳过）
  const health = await request.get(`${API}/api/health`);
  expect(health.ok(), '后端未启动：请先运行 mock 模式服务').toBeTruthy();

  const name = `e2e-${Date.now()}`;
  const created = await request.post(`${API}/api/projects`, { data: { name } });
  expect(created.status()).toBe(201);

  await page.goto('/#/workspace');
  await page.waitForLoadState('networkidle');
  // 多项目时默认选列表第一个，不能假设就是本次新建的 → 显式点选侧栏里的新项目
  await page.locator('aside').getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: /运行流水线/ })).toBeVisible({ timeout: 20_000 });

  const composer = page.getByPlaceholder(/问问题/);
  await composer.fill('请用一句话解释什么是图神经网络');
  await composer.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

  // 用户气泡立刻出现
  await expect(page.getByText('请用一句话解释什么是图神经网络')).toBeVisible({ timeout: 10_000 });

  // 助手消息节点出现且非空（mock 网关会返回文本；空字符串视为失败）
  const assistant = page.locator('[data-testid="assistant-message"]').last();
  await expect(assistant).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 30_000, intervals: [500, 1000, 2000] })
    .toBeGreaterThan(0);
});
