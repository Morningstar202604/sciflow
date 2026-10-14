import { expect, test } from '@playwright/test';

/**
 * 对话工作台冒烟：壳加载 → 默认落在工作台视图 → 核心控件在场。
 * 需后端（mock 模式）+ 前端 dev server 均已启动（见 playwright.config.ts 注释）。
 */
test('工作台首屏：默认视图 + 对话/预览/流水线入口', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible();
  // 未建项目时展示引导；已建项目时展示工作台三件套。两种状态均属通过。
  const onboarding = page.getByText('请先创建一个研究项目');
  const workspace = page.getByRole('button', { name: /运行流水线/ });
  await expect(onboarding.or(workspace).first()).toBeVisible({ timeout: 15_000 });
  if (await workspace.isVisible().catch(() => false)) {
    await expect(page.getByRole('button', { name: /发送/ })).toBeVisible();
  }
});
