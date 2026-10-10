/**
 * SciFlow 桌面端 · 主进程
 *
 * 生命周期：单实例锁 → 启动内嵌后端 → 创建窗口（等待 /api/health 就绪）
 * 安全基线：contextIsolation + 无 nodeIntegration + 外链走系统浏览器 + 回环监听
 */

import { app, BrowserWindow, ipcMain, shell, Menu, dialog, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { startServer, isDev, type ServerHandle } from './server-manager';
import { initAutoUpdater } from './auto-updater';

let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

// ---------- 全局兜底：后端/更新类异步异常不崩窗口 ----------
process.on('unhandledRejection', (reason) => {
  console.error('[SciFlow Desktop] unhandledRejection:', reason instanceof Error ? reason.stack : String(reason));
});
process.on('uncaughtException', (err) => {
  console.error('[SciFlow Desktop] uncaughtException:', err.stack || err.message);
});

// ---------- 单实例锁：二次启动唤起已有窗口 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- 优雅退出：先停后端（WAL 安全落盘），再退进程 ----------
async function gracefulQuit() {
  if (quitting) return;
  quitting = true;
  try {
    if (serverHandle) await serverHandle.stop();
  } catch (e) {
    console.error('[SciFlow Desktop] 停止后端失败（继续退出）:', e);
  }
  app.exit(0);
}

app.on('before-quit', (e) => {
  if (!quitting && serverHandle) {
    e.preventDefault();
    void gracefulQuit();
  }
});
app.on('window-all-closed', () => {
  // 内嵌后端随窗口关闭一起退出：数据已在 SIGTERM 时安全落盘
  void gracefulQuit();
});

// ---------- IPC：渲染进程能力桥 ----------
ipcMain.on('app:open-external', (_e, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    void shell.openExternal(url);
  }
});
ipcMain.on('app:get-info', (e) => {
  // preload 以 sendSync 同步获取：窗口加载前完成注入
  e.returnValue = {
    apiBase: serverHandle ? `http://127.0.0.1:${serverHandle.port}` : '',
    version: app.getVersion(),
    platform: process.platform,
    mode: isDev ? 'dev' : 'production',
  };
});

// ---------- 窗口创建 ----------
function createWindow(apiBase: string) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'SciFlow · 让科研从想法到成文',
    backgroundColor: '#f4f6fb', // 品牌底色，避免启动白闪
    autoHideMenuBar: true,
    show: false,
    icon: isDev ? path.join(__dirname, '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // 外链一律走系统浏览器，不在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // 生产环境禁用 DevTools 快捷键误触（dev 保留）
  if (!isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') event.preventDefault();
    });
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev) {
    const devUrl = process.env.SCIFLOW_DEV_WEB_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<body style="font-family:sans-serif;background:#f4f6fb;color:#1c2a44;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
             <h2>未检测到前端开发服务器</h2>
             <p>请先在仓库根目录执行：<code>pnpm dev:web</code>，然后重启桌面端（<code>pnpm desktop:dev</code>）。</p>
             <p style="color:#64748b">后端 API 已就绪：${apiBase}</p></body>`,
          ),
      );
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(process.resourcesPath, 'web', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- 应用就绪：起后端 → 起窗口 → 可选自动更新 ----------
// 单实例锁失败时 app.quit() 已触发，此处必须以 gotLock 收口：
// 否则 quit 过程中 whenReady 仍可能 resolve，第二实例会重复 spawn 后端/开窗。
async function bootstrap() {
  // macOS 必须保留应用菜单：置 null 会导致 Cmd+C/V/Q 等标准编辑快捷键全部失效；
  // Windows/Linux 无菜单栏依赖，保持无菜单（应用内导航 + ⌘K 命令面板）。
  if (process.platform === 'darwin') {
    const template: MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }

  try {
    serverHandle = await startServer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void dialog.showErrorBox(
      'SciFlow 启动失败',
      `内嵌后端未能启动：\n\n${msg}\n\n日志目录：${app.getPath('userData')}${path.sep}logs`,
    );
    app.exit(1);
    return;
  }

  createWindow(`http://127.0.0.1:${serverHandle.port}`);
  initAutoUpdater();
}

if (gotLock) {
  void app.whenReady().then(bootstrap);
}
