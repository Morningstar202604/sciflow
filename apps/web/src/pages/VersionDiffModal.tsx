import { useMemo, useState } from 'react';
import { Button, Modal, Select } from '../components/ui';

/** 版本快照（doc.versions 为 {version,content,updatedAt}[] JSON 字符串；current 为当前编辑态） */
export type VersionSnapshot = { version: number; content: string; updatedAt: number; current?: boolean };

/* =====================================================================
 * 轻量行级 diff（LCS DP，零依赖；超行截断兜底）——独立 chunk，仅打开对比时加载
 * ===================================================================== */
type DiffRow = { kind: 'same' | 'del' | 'add'; left: string | null; right: string | null };
function diffLines(oldText: string, newText: string): DiffRow[] {
  const L = oldText.split('\n').slice(0, 500);
  const R = newText.split('\n').slice(0, 500);
  const n = L.length;
  const m = R.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = L[i] === R[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (L[i] === R[j]) {
      rows.push({ kind: 'same', left: L[i], right: R[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', left: L[i], right: null });
      i++;
    } else {
      rows.push({ kind: 'add', left: null, right: R[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: 'del', left: L[i++], right: null });
  while (j < m) rows.push({ kind: 'add', left: null, right: R[j++] });
  return rows;
}

export function VersionDiffModal({
  open,
  onClose,
  docId,
  snapshots,
  diffA,
  diffB,
  onSelectA,
  onSelectB,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  snapshots: VersionSnapshot[];
  diffA: string;
  diffB: string;
  onSelectA: (v: string) => void;
  onSelectB: (v: string) => void;
  onRestore: (s: VersionSnapshot) => void;
}) {
  // 版本命名：后端 versions 无 name 字段 → localStorage 本地记录
  const [, forceTick] = useState(0);
  const vNameKey = (v: number) => `sciflow:vname:${docId}:v${v}`;
  const getVName = (v: number): string => {
    try {
      return localStorage.getItem(vNameKey(v)) || '';
    } catch {
      return '';
    }
  };
  const renameVersion = (v: number, name: string) => {
    try {
      if (name.trim()) localStorage.setItem(vNameKey(v), name.trim());
      else localStorage.removeItem(vNameKey(v));
    } catch {
      /* ignore */
    }
    forceTick((t) => t + 1);
  };

  const snapOptions = snapshots.map((s) => ({
    value: s.current ? 'current' : `v${s.version}`,
    label: s.current
      ? `当前内容 (v${snapshots[snapshots.length - 1]?.version ?? '?'})`
      : `v${s.version} · ${new Date(s.updatedAt).toLocaleString()}${getVName(s.version) ? ` · ${getVName(s.version)}` : ''}`,
  }));
  const findSnap = (key: string): VersionSnapshot | null => {
    if (key === 'current') return snapshots[snapshots.length - 1] || null;
    const v = Number(key.replace('v', ''));
    return snapshots.find((s) => !s.current && s.version === v) || null;
  };
  const diffRows = useMemo(() => {
    const a = findSnap(diffA);
    const b = findSnap(diffB);
    if (!a || !b) return [] as DiffRow[];
    return diffLines(a.content, b.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffA, diffB, snapshots]);

  return (
    <Modal open={open} title="版本对比（左右栏 Diff）" onClose={onClose} width="max-w-5xl">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select options={snapOptions} value={diffA} onChange={onSelectA} className="text-xs flex-1" />
        <span className="text-slate-400 shrink-0">→</span>
        <Select options={snapOptions} value={diffB} onChange={onSelectB} className="text-xs flex-1" />
      </div>
      <div className="flex gap-2 mb-3 text-[11px]">
        {(['左', '右'] as const).map((side, idx) => {
          const key = idx === 0 ? diffA : diffB;
          const s = findSnap(key);
          if (!s) return null;
          return (
            <div key={side} className="flex-1 flex items-center gap-1.5">
              <span className="text-slate-400 shrink-0">{side} · v{s.version}</span>
              <input
                className="flex-1 min-w-0 rounded border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-0.5 text-xs"
                placeholder="命名此版本…"
                defaultValue={getVName(s.version)}
                onBlur={(e) => renameVersion(s.version, e.target.value)}
              />
              {!s.current && (
                <Button variant="outline" className="text-[10px] px-1.5 py-0.5 shrink-0" onClick={() => onRestore(s)}>
                  恢复此版
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-0 font-mono text-[11px] leading-relaxed max-h-[58vh] overflow-auto border border-slate-100 dark:border-slate-800 rounded">
        {(['left', 'right'] as const).map((side) => (
          <div key={side} className={`min-w-0 ${side === 'left' ? 'border-r border-slate-100 dark:border-slate-800' : ''}`}>
            {diffRows.map((r, i) => {
              const txt = side === 'left' ? r.left : r.right;
              const hot = side === 'left' ? r.kind === 'del' : r.kind === 'add';
              return txt != null ? (
                <div key={i} className={`px-2 whitespace-pre-wrap break-words ${hot ? (side === 'left' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-300') : 'text-slate-600 dark:text-slate-300'}`}>{txt || ' '}</div>
              ) : (
                <div key={i} className="px-2 text-transparent"> </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
        红 = 左栏独有（相对删除） · 绿 = 右栏独有（新增） · 按行 LCS 对比。版本名保存在浏览器本地（后端 versions 暂不支持命名）。
      </div>
    </Modal>
  );
}
