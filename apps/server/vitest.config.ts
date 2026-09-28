import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 只跑 src 下的单元测试，排除 dist/ 编译产物（此前 dist 内的 .spec.js 被误扫导致 CommonJS 加载失败）
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
