import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Button, Modal, Select, errMsg } from '../components/ui';

/** 版本快照（doc.versions 为 {version,content,updatedAt,name?}[] JSON 字符串；current 为当前编辑态） */
export type VersionSnapshot = { version: number; content: string; updatedAt: number; current?: boolean; name?: string };

/* =====================================================================
 * 轻量行级 diff（LCS DP，零依赖）——独立 chunk，仅打开对比时加载
 *
 * 性能策略（缺口#3）：
 *  - 常见长论文（数百 ~ 2000 行正文）**不截断**完整对比；
 *  - DP 表用扁平化 Int32Array（4 字节/格），2000×2000 ≈ 16MB、约 4M 格，JS 可承受；
 *  - 极端超长（> 阈值 或 DP 格子数超上限）才降级截断，并在底部提示。
 * ===================================================================== */
type DiffRow = { kind: 'same' | 'del' | 'add'; left: string | null; right: string | null };
type DiffResult = { rows: DiffRow[]; truncated: boolean };

/** 行数不截断上限：常见长论文正文 ≤ 此值 */
const MAX_DIFF_LINES = 2000;
/** DP 格子总数上限（≈2236×2236），保护内存；超限按比例裁切并提示 */
const MAX_DIFF_CELLS = 5_000_000;

function diffLines(oldText: string, newText: string): DiffResult {
  let L = oldText.split('\n');
  let R = newText.split('\n');
  let truncated = false;

  // 行数兜底：超过 2000 行才截断（极端场景）
  if (L.length > MAX_DIFF_LINES || R.length > MAX_DIFF_LINES) {
    truncated = true;
    L = L.slice(0, MAX_DIFF_LINES);
    R = R.slice(0, MAX_DIFF_LINES);
  }
  // 内存兜底：DP 格子数超上限时按比例裁，避免整表过大卡死/白屏
  if (L.length * R.length > MAX_DIFF_CELLS) {
    truncated = true;
    const scale = Math.sqrt(MAX_DIFF_CELLS / (L.length * R.length));
    L = L.slice(0, Math.max(1, Math.floor(L.length * scale)));
    R = R.slice(0, Math.max(1, Math.floor(R.length * scale)));
  }

  const n = L.length;
  const m = R.length;
  // 扁平化 DP：dp[i][j] = dp[i*(m+1)+j]；Int32Array 零初始化、4 字节/格
  const rowLen = m + 1;
  const dp = new Int32Array((n + 1) * rowLen);
  for (let i = n - 1; i >= 0; i--) {
    const cur = i * rowLen;
    const nxt = (i + 1) * rowLen;
    for (let j = m - 1; j >= 0; j--) {
      dp[cur + j] = L[i] === R[j] ? dp[nxt + j + 1] + 1 : Math.max(dp[nxt + j], dp[cur + j + 1]);
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
    } else if (dp[(i + 1) * rowLen + j] >= dp[i * rowLen + j + 1]) {
      rows.push({ kind: 'del', left: L[i], right: null });
      i++;
    } else {
      rows.push({ kind: 'add', left: null, right: R[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: 'del', left: L[i++], right: null });
  while (j < m) rows.push({ kind: 'add', left: null, right: R[j++] });
  return { rows, truncated };
}

/* =====================================================================
 * 版本命名（缺口#2 前端半）：读写全走后端 PATCH /api/documents/:id/version-name
 * （client 方法 documents.setVersionName，返回更新后的 versions 数组）。
 * 一次性迁移浏览器 localStorage 旧命名到后端，成功后删 key，失败保留待重试。
 * ===================================================================== */
/** 旧版 localStorage key 前缀：sciflow:vname:<docId>:v<N> */
const vNamePrefix = (docId: string) => `sciflow:vname:${docId}:v`;

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
  // 版本命名：优先后端 versions[].name，本地态兜底会话内即时刷新
  const [names, setNames] = useState<Record<number, string>>({});
  const [migNote, setMigNote] = useState('');

  // 用后端返回的 name 播种本地态（已有本地值不覆盖）
  useEffect(() => {
    setNames((prev) => {
      const next = { ...prev };
      for (const s of snapshots) if (s.name && !next[s.version]) next[s.version] = s.name;
      return next;
    });
  }, [snapshots]);

  /** 一次性迁移：挂载/打开时把 localStorage 旧命名逐条写后端，成功后删 key；失败保留待重试 */
  useEffect(() => {
    if (!open || !docId) return;
    const prefix = vNamePrefix(docId);
    let cancelled = false;
    (async () => {
      let keys: string[] = [];
      try {
        keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      } catch {
        return;
      }
      if (keys.length === 0) return;
      let failed = 0;
      for (const k of keys) {
        const v = Number(k.slice(prefix.length));
        const name = (() => { try { return localStorage.getItem(k) || ''; } catch { return ''; } })();
        if (!Number.isFinite(v)) continue;
        if (!name) {
          try { localStorage.removeItem(k); } catch { /* ignore */ }
          continue;
        }
        try {
          await api.documents.setVersionName(docId, v, name);
          if (cancelled) return;
          setNames((p) => ({ ...p, [v]: name }));
          try { localStorage.removeItem(k); } catch { /* ignore */ }
        } catch {
          failed++; // 保留原 key 供下次重试
        }
      }
      if (!cancelled && failed > 0) {
        setMigNote(`${failed} 个旧版本命名迁移到后端失败，已保留在浏览器本地，下次打开自动重试`);
      }
    })();
    return () => { cancelled = true; };
  }, [open, docId]);

  const getVName = (v: number) => names[v] || '';

  const renameVersion = async (v: number, name: string) => {
    const trimmed = name.trim();
    setNames((p) => ({ ...p, [v]: trimmed })); // 乐观更新，会话内即时生效
    try {
      await api.documents.setVersionName(docId, v, trimmed);
    } catch (e: unknown) {
      setMigNote(`版本命名保存到后端失败：${errMsg(e)}（已保留本地显示，稍后重试）`);
    }
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
  const diffResult = useMemo(() => {
    const a = findSnap(diffA);
    const b = findSnap(diffB);
    if (!a || !b) return { rows: [] as DiffRow[], truncated: false };
    return diffLines(a.content, b.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffA, diffB, snapshots]);
  const diffRows = diffResult.rows;

  return (
    <Modal open={open} title="版本对比（左右栏 Diff）" onClose={onClose} width="max-w-5xl">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select options={snapOptions} value={diffA} onChange={onSelectA} className="text-xs flex-1" />
        <span className="text-slate-400 shrink-0">→</span>
        <Select options={snapOptions} value={diffB} onChange={onSelectB} className="text-xs flex-1" />
      </div>
      <div className="flex gap-2 mb-3 text-[11px] flex-wrap">
        {(['左', '右'] as const).map((side, idx) => {
          const key = idx === 0 ? diffA : diffB;
          const s = findSnap(key);
          if (!s) return null;
          return (
            <div key={side} className="flex-1 min-w-[180px] flex items-center gap-1.5">
              <span className="text-slate-400 shrink-0">{side} · v{s.version}</span>
              {s.current ? (
                <span className="text-[10px] text-slate-300 dark:text-slate-600 shrink-0">（当前内容，不可命名）</span>
              ) : (
                <input
                  key={`${s.version}-${getVName(s.version)}`}
                  className="flex-1 min-w-0 rounded border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-0.5 text-xs"
                  placeholder="命名此版本…"
                  defaultValue={getVName(s.version)}
                  onBlur={(e) => renameVersion(s.version, e.target.value)}
                />
              )}
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
        红 = 左栏独有（相对删除） · 绿 = 右栏独有（新增） · 按行 LCS 对比（≤{MAX_DIFF_LINES} 行完整对比）。
        版本名保存在后端；浏览器本地旧命名已自动迁移。
        {diffResult.truncated && (
          <span className="text-amber-500 dark:text-amber-400"> · ⚠ 文本过长，已截取前 {MAX_DIFF_LINES} 行做对比（极端降级）</span>
        )}
        {migNote && <span className="text-amber-500 dark:text-amber-400 block mt-0.5"> · {migNote}</span>}
      </div>
    </Modal>
  );
}
