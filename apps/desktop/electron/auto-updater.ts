/**
 * SciFlow 桌面端 · 自动更新（opt-in）
 *
 * 设计原则（本地优先 / 不偷偷联网）：
 *  - 仅在打包构建且显式配置 SCIFLOW_UPDATE_URL 时启用；
 *  - 更新源走 generic provider（自建静态文件源：latest.yml + 安装包），企业内网可自托管；
 *  - 不配置则完全静默跳过，零网络请求。
 */

import { app, dialog, BrowserWindow } from 'electron';

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;
  const feed = process.env.SCIFLOW_UPDATE_URL;
  if (!feed) return; // 未配置更新源 → 完全关闭

  try {
    // electron-updater 为运行时依赖，打包后位于 app.asar/node_modules
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    autoUpdater.autoDownload = false; // 先询问再下载，用户可控

    autoUpdater.on('update-available', async (info) => {
      const win = BrowserWindow.getAllWindows()[0];
      const r = await dialog.showMessageBox(win, {
        type: 'info',
        title: '发现新版本',
        message: `SciFlow ${info.version} 已发布，是否下载更新？`,
        buttons: ['下载更新', '暂不'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response === 0) void autoUpdater.downloadUpdate();
    });

    autoUpdater.on('update-downloaded', async () => {
      const win = BrowserWindow.getAllWindows()[0];
      const r = await dialog.showMessageBox(win, {
        type: 'info',
        title: '更新就绪',
        message: '更新已下载完成，重启应用以完成安装。',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response === 0) void autoUpdater.quitAndInstall();
    });

    autoUpdater.on('error', (err) => {
      console.error('[SciFlow Desktop] 自动更新失败（静默，不影响使用）:', err?.message || err);
    });

    void autoUpdater.checkForUpdates().catch(() => {
      /* 网络不可达时静默：本地优先，离线完全可用 */
    });
  } catch (e) {
    console.error('[SciFlow Desktop] electron-updater 初始化失败:', e);
  }
}
