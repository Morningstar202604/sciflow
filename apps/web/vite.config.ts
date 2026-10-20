import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/** 与后端共用的能力层（packages/core）—— 用别名而非深相对路径，与 server 侧约定一致 */
const coreSrc = fileURLToPath(new URL('../../packages/core/src', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@sciflow/core': coreSrc },
  },
  server: {
    port: 5173,
    // 允许读取仓库根下的 packages/（dev server 默认只允许项目根）
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 代码分割：React 框架与图标库拆为独立 vendor chunk，优化首屏与缓存
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
          ui: ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
