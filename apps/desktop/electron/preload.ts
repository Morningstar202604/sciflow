/**
 * SciFlow 桌面端 · 预加载脚本（安全桥）
 *
 * 在页面脚本运行前执行，经 contextBridge 暴露最小能力面：
 *  - apiBase：内嵌后端地址（前端 client.ts 读取后拼接 API 请求）
 *  - openExternal：系统浏览器打开外链（仅 http/https）
 * 不暴露任何 Node/Electron 原生能力。
 */

import { contextBridge, ipcRenderer } from 'electron';

const info = ipcRenderer.sendSync('app:get-info') as {
  apiBase: string;
  version: string;
  platform: string;
  mode: string;
};

contextBridge.exposeInMainWorld('sciflowDesktop', {
  apiBase: info.apiBase,
  version: info.version,
  platform: info.platform,
  mode: info.mode,
  openExternal: (url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      ipcRenderer.send('app:open-external', url);
    }
  },
});
