import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Doc, Project } from '../types';

// mock API 层（api + streamChat）：WorkspacePage 是纯组合组件，数据全部经 React Query + api 拿
const docA: Doc = {
  id: 'doc-1',
  projectId: 'p-1',
  title: '验收样稿',
  content: '## 引言\n\n图神经网络的正文内容。',
  version: 2,
  status: 'draft',
  createdAt: 0,
  updatedAt: 0,
} as Doc;

vi.mock('../api/client', () => ({
  api: {
    documents: {
      list: vi.fn(async () => [docA]),
      get: vi.fn(async () => docA),
      create: vi.fn(async () => docA),
    },
    pipeline: { create: vi.fn(), get: vi.fn(), confirmOutline: vi.fn() },
  },
  streamChat: vi.fn(() => () => undefined),
}));

import { WorkspacePage } from './WorkspacePage';

const project: Project = { id: 'p-1', name: '测试项目', description: '', status: 'active', createdAt: 0, updatedAt: 0 } as Project;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspacePage project={project} initialDocId={null} onOpenFullEditor={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('WorkspacePage（对话+预览工作台）', () => {
  it('拉取文档列表并自动选中第一篇（标题出现在选择器与预览头）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('验收样稿').length).toBeGreaterThanOrEqual(2)); // option + 预览头
  });

  it('右侧预览渲染文档正文（Markdown → prose）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/图神经网络的正文内容/)).toBeTruthy());
  });

  it('空线程显示引导文案；输入为空时发送按钮禁用', async () => {
    renderPage();
    expect(screen.getByText('开始与 SciFlow 对话')).toBeTruthy();
    const sendBtn = screen.getByRole('button', { name: /发送/ });
    expect(sendBtn).toBeDisabled();
  });

  it('顶部提供运行流水线与完整编辑器入口', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: /运行流水线/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /完整编辑器/ })).toBeTruthy());
  });
});
