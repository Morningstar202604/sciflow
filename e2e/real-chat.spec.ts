import { expect, test } from '@playwright/test';

/**
 * 真实模型端到端冒烟（需真实 AI 端点；CI 默认跳过）。
 * 运行前置：
 *   1) 真实 key 启动后端：AI_BASE_URL=... AI_API_KEY=... AI_MODEL=... node apps/server/dist/apps/server/src/main.js
 *   2) 前端 dev：VITE_API_TARGET=<真实后端> vite
 *   3) E2E_REAL=1 E2E_BASE=http://localhost:<web> npx playwright test e2e/real-chat.spec.ts
 * 成本控制：本规格仅发 1 次聊天调用（短问题），不触发流水线。
 */
const REAL = process.env.E2E_REAL === '1';
test.skip(!REAL, 'E2E_REAL!=1：真实模型规格跳过（CI 安全，见文件头注释）');

test('工作台 → 真实模型对话：SSE 流式回复渲染', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible({ timeout: 30_000 });

  // 等首屏项目加载完成后：已有项目 → 工作台直达；空库 → 先建项目
  const runBtn = page.getByRole('button', { name: /运行流水线/ });
  const welcome = page.getByText('请先创建一个研究项目');
  await expect(runBtn.or(welcome).first()).toBeVisible({ timeout: 20_000 });
  if (!(await runBtn.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /新建项目/ }).first().click();
    const dialog = page.getByRole('dialog').or(page.locator('.fixed.inset-0')).first();
    await dialog.locator('input').first().fill('真实模型E2E');
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await expect(runBtn).toBeVisible({ timeout: 15_000 });
  }

  // 发送一条短问题（仅 1 次真实调用）
  const composer = page.getByPlaceholder(/问问题|让 AI 起草/);
  await composer.fill('一句话：什么是思维链？');
  await page.getByRole('button', { name: /发送/ }).click();

  // 等待流式回复落地（主区域内出现中文回答；不加全局容器选择器，避免命中侧栏）
  await expect(page.getByTestId('chat-thread').getByText(/思维链|推理|步骤/).first()).toBeVisible({ timeout: 90_000 });
});
