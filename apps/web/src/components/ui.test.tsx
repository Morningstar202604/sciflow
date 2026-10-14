import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, Badge, Empty, Spinner, Input, Select } from './ui';

describe('Button', () => {
  it('renders children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>保存</Button>);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables interaction while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        生成
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /生成/ });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders disabled state', () => {
    render(
      <Button disabled>
        <span>删除</span>
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Badge / Spinner / Empty', () => {
  it('Badge renders text with tone class', () => {
    render(<Badge tone="green">通过</Badge>);
    const el = screen.getByText('通过');
    expect(el.className).toContain('emerald');
  });

  it('Spinner exposes status role and default label', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('处理中…')).toBeTruthy();
  });

  it('Empty shows text and hint', () => {
    render(<Empty text="暂无项目" hint="先创建一个项目" />);
    expect(screen.getByText('暂无项目')).toBeTruthy();
    expect(screen.getByText('先创建一个项目')).toBeTruthy();
  });
});

describe('Input / Select', () => {
  it('Input forwards typing', async () => {
    render(<Input placeholder="研究主题" />);
    const input = screen.getByPlaceholderText('研究主题');
    await userEvent.type(input, '图神经网络');
    expect((input as HTMLInputElement).value).toBe('图神经网络');
  });

  it('Select calls onChange with picked value', () => {
    const onChange = vi.fn();
    render(
      <Select
        value="apa"
        onChange={onChange}
        options={[
          { value: 'apa', label: 'APA' },
          { value: 'ieee', label: 'IEEE' },
        ]}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ieee' } });
    expect(onChange).toHaveBeenCalledWith('ieee');
  });
});
