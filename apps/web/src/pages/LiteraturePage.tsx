import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, ClipboardList, Download, FileDown, Filter, FlaskConical, GitCompareArrows, Lightbulb, ListChecks, Loader2, Network, Plus, Search, Table2, Trash2, Upload, X } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { DeepDiveResult, EvidenceResult, ExtractedPaper, ExtractionField, ExtractionTableResult, GapResult, PaperComparisonResult, Project, Reference, ReferenceGraph, ScreeningItem } from '../types';
import { Badge, Button, Card, CollapsibleCard, Empty, ErrorBox, Input, Select, Spinner, Textarea, downloadText, jsonText } from '../components/ui';
import { ChartEmpty, Donut, HBar, SegBar } from '../components/charts';

type Tool = 'summary' | 'extract' | 'evidence' | 'deepdive' | 'gap' | 'compare' | 'graph';

const TOOLS: { key: Tool; label: string; icon: typeof ListChecks; hint: string }[] = [
  { key: 'summary', label: '文献综述', icon: Download, hint: 'STORM 式结构化综述' },
  { key: 'extract', label: '结构化提取', icon: ListChecks, hint: 'Elicit 式对比表' },
  { key: 'evidence', label: '证据综合', icon: GitCompareArrows, hint: 'Consensus 式共识度' },
  { key: 'deepdive', label: '单篇精读', icon: BookOpenCheck, hint: 'Lateral 式论文解剖' },
  { key: 'gap', label: '研究缺口', icon: Lightbulb, hint: '科研选题定位' },
  { key: 'compare', label: '文献对比', icon: Table2, hint: '多篇横向对比表' },
  { key: 'graph', label: '引用网络', icon: Network, hint: '共引/去重关系图' },
];

/* =====================================================================
 * 引用网络图：自研 Fruchterman-Reingold 力导向布局（零依赖，纯 SVG）
 * ---------------------------------------------------------------------
 * - 节点圆内随机初始化，250 轮（大图 120 轮）：斥力 k²/d、引力 d²/k、温度衰减
 * - 节点半径随被引数对数缩放；颜色按 venue 前 6 归类，其余灰
 * - dup 边红色虚线、共引边品牌色细线（线宽随 weight）
 * - 支持拖拽 / 点击选中 / 一跳邻居高亮 / 空白取消
 * ===================================================================== */
type Pt = { x: number; y: number };
const VENUE_COLORS = ['#0d9488', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981'];

function computeLayout(nodes: { id: string }[], edges: { a: string; b: string }[]): Map<string, Pt> {
  const n = nodes.length;
  const W = 900;
  const H = 600;
  const pos = new Map<string, Pt>();
  nodes.forEach((nd, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = 140 + (i % 6) * 26;
    pos.set(nd.id, { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r });
  });
  if (n < 2) return pos;
  const k = Math.sqrt((W * H) / n);
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const disp: Pt[] = nodes.map(() => ({ x: 0, y: 0 }));
  let temp = W / 6;
  const iters = n > 120 ? 120 : 250;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      disp[i].x = 0;
      disp[i].y = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pi = pos.get(nodes[i].id)!;
        const pj = pos.get(nodes[j].id)!;
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d = 1;
        }
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
      }
    }
    for (const e of edges) {
      const i = idx.get(e.a);
      const j = idx.get(e.b);
      if (i === undefined || j === undefined) continue;
      const pi = pos.get(nodes[i].id)!;
      const pj = pos.get(nodes[j].id)!;
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k;
      disp[i].x -= (dx / d) * f;
      disp[i].y -= (dy / d) * f;
      disp[j].x += (dx / d) * f;
      disp[j].y += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const pi = pos.get(nodes[i].id)!;
      const m = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y) || 0.01;
      const lim = Math.min(m, temp);
      pi.x += (disp[i].x / m) * lim;
      pi.y += (disp[i].y / m) * lim;
      // 轻微向心牵引，防止布局漂移出界
      pi.x += (W / 2 - pi.x) * 0.015;
      pi.y += (H / 2 - pi.y) * 0.015;
    }
    temp *= 0.93;
  }
  return pos;
}

function ReferenceNetwork({ graph, onViewRef }: { graph: ReferenceGraph; onViewRef?: (id: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useMemo(() => computeLayout(graph.nodes, graph.edges), [graph]);
  const [pos, setPos] = useState<Map<string, Pt>>(layout);
  const [selected, setSelected] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);

  useEffect(() => {
    setPos(layout);
    setSelected(null);
  }, [layout]);

  // venue 前 6 类各一色
  const venueColor = useMemo(() => {
    const m = new Map<string, number>();
    graph.nodes.forEach((nd) => {
      const v = nd.venue || '未标注';
      m.set(v, (m.get(v) || 0) + 1);
    });
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
    const map = new Map<string, string>();
    top.forEach((v, i) => map.set(v, VENUE_COLORS[i % VENUE_COLORS.length]));
    return map;
  }, [graph]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    graph.edges.forEach((e) => {
      if (!m.has(e.a)) m.set(e.a, new Set());
      if (!m.has(e.b)) m.set(e.b, new Set());
      m.get(e.a)!.add(e.b);
      m.get(e.b)!.add(e.a);
    });
    return m;
  }, [graph]);

  // viewBox 按当前坐标包围盒 fit
  const vb = useMemo(() => {
    if (graph.nodes.length === 0) return '0 0 900 600';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pos.forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    const pad = 50;
    return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  }, [pos, graph]);

  const toSvgPt = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  const selNode = selected ? graph.nodes.find((n) => n.id === selected) : null;
  const neighborSet = selected ? neighbors.get(selected) : undefined;

  return (
    <div>
      {graph.nodes.length > 200 && (
        <div className="text-xs text-amber-600 dark:text-amber-400 mb-2">
          节点较多（{graph.nodes.length}），为保证流畅已减少布局迭代；建议聚焦高被引节点。
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={vb}
        className="w-full h-[420px] rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 touch-none"
        onClick={(e) => {
          if (e.target === svgRef.current) setSelected(null);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          d.moved = true;
          const p = toSvgPt(e.clientX, e.clientY);
          setPos((prev) => {
            const next = new Map(prev);
            next.set(d.id, p);
            return next;
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        {graph.edges.map((e, i) => {
          const pa = pos.get(e.a);
          const pb = pos.get(e.b);
          if (!pa || !pb) return null;
          const isDup = e.type === 'dup';
          const dim = !!selected && e.a !== selected && e.b !== selected && !neighborSet?.has(e.a) && !neighborSet?.has(e.b);
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={isDup ? '#f43f5e' : 'var(--brand-500)'}
              strokeWidth={isDup ? 1.6 : Math.min(3, 0.5 + e.weight * 0.5)}
              strokeDasharray={isDup ? '5 4' : undefined}
              opacity={dim ? 0.08 : isDup ? 0.85 : 0.3 + Math.min(0.4, e.weight * 0.1)}
            >
              <title>{isDup ? `重复关系` : `共引 ${e.weight} 篇文档`}</title>
            </line>
          );
        })}
        {graph.nodes.map((nd) => {
          const p = pos.get(nd.id);
          if (!p) return null;
          const isSel = selected === nd.id;
          const isNeighbor = !!neighborSet?.has(nd.id);
          const dim = !!selected && !isSel && !isNeighbor;
          const r = 4 + Math.min(11, Math.log10((nd.citationCount || 0) + 1) * 3.5);
          const color = venueColor.get(nd.venue || '未标注') || '#94a3b8';
          return (
            <circle
              key={nd.id}
              cx={p.x}
              cy={p.y}
              r={r}
              fill={color}
              fillOpacity={dim ? 0.15 : isSel ? 1 : 0.85}
              stroke={isSel ? '#0f172a' : '#fff'}
              strokeWidth={isSel ? 2.5 : 1}
              className="dark:stroke-slate-900 cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                dragRef.current = { id: nd.id, moved: false };
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                const d = dragRef.current;
                dragRef.current = null;
                if (d && !d.moved) setSelected((cur) => (cur === nd.id ? null : nd.id));
              }}
            >
              <title>{`${nd.title}（${nd.year || 'n.d.'}）被引 ${nd.citationCount}`}</title>
            </circle>
          );
        })}
      </svg>

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="text-slate-400">颜色 = venue（前 6）</span>
        {[...venueColor.entries()].slice(0, 6).map(([v, c]) => (
          <span key={v} className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
            {v.slice(0, 12) || '未标注'}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="w-6 border-t border-dashed border-rose-500" /> 重复文献
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-6 border-t border-[var(--brand-500)]" /> 共引关系
        </span>
      </div>

      {/* 选中详情卡 */}
      {selNode && (
        <div className="mt-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-3">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{selNode.title}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {selNode.year || 'n.d.'} · {selNode.venue || '未标注'} · 被引 {selNode.citationCount} · 阅读状态 {selNode.readingStatus || 'unread'}
          </div>
          {selNode.tags?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {selNode.tags.map((t) => (
                <Badge key={t} tone="teal">{t}</Badge>
              ))}
            </div>
          )}
          <div className="mt-2">
            <Button variant="outline" className="text-xs" onClick={() => onViewRef?.(selNode.id)}>
              去文献库查看
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type ScreenStatus = 'pending' | 'included' | 'excluded' | 'uncertain';
const SCREEN_META: Record<ScreenStatus, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' }> = {
  pending: { label: '待筛', tone: 'slate' },
  included: { label: '纳入', tone: 'green' },
  excluded: { label: '排除', tone: 'red' },
  uncertain: { label: '不确定', tone: 'amber' },
};

export function LiteraturePage({ project }: { project: Project }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<Reference[]>([]);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>('summary');
  const [summary, setSummary] = useState('');
  const [extracted, setExtracted] = useState<ExtractedPaper[]>([]);
  const [evidence, setEvidence] = useState<EvidenceResult | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deepDive, setDeepDive] = useState<DeepDiveResult | null>(null);
  const [deepDiveRef, setDeepDiveRef] = useState('');
  const [gapResult, setGapResult] = useState<GapResult | null>(null);
  const [gapTopic, setGapTopic] = useState('');
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<PaperComparisonResult | null>(null);
  // 手动添加文献表单
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addAuthors, setAddAuthors] = useState('');
  const [addYear, setAddYear] = useState('');
  const [addVenue, setAddVenue] = useState('');
  const [addDoi, setAddDoi] = useState('');
  const [addAbstract, setAddAbstract] = useState('');
  const [adding, setAdding] = useState(false);

  // —— 系统综述：筛选队列 ——
  const [screenItems, setScreenItems] = useState<ScreeningItem[]>([]);
  const [showScreen, setShowScreen] = useState(false);
  const [screenFilter, setScreenFilter] = useState<'all' | ScreenStatus>('all');
  const [screenSelected, setScreenSelected] = useState<Set<string>>(new Set());
  const [screenBusy, setScreenBusy] = useState(false);
  // —— 系统综述：编码抽取表 ——
  const [extFields, setExtFields] = useState<ExtractionField[]>([]);
  const [extTable, setExtTable] = useState<ExtractionTableResult | null>(null);
  const [showExtraction, setShowExtraction] = useState(false);
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState('');
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldKind, setNewFieldKind] = useState<'text' | 'select'>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  // —— 引用网络图 ——
  const [graph, setGraph] = useState<ReferenceGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  // —— BibTeX 导出/导入 ——
  const [showImport, setShowImport] = useState(false);
  const [bibText, setBibText] = useState('');
  const [importing, setImporting] = useState(false);
  const toast = useContext(ToastContext);

  useEffect(() => {
    api.references.list(project.id).then(setRefs).catch((e) => setError(e.message));
  }, [project.id]);

  // 加载筛选队列（后端未就绪时优雅降级为空数组）
  useEffect(() => {
    api.references.screenList(project.id).then(setScreenItems).catch(() => setScreenItems([]));
  }, [project.id]);

  // 引用网络：切到该 Tab 时懒加载一次（导入/删除文献后置空以触发下次刷新）
  useEffect(() => {
    if (tool === 'graph' && !graph) {
      setGraphLoading(true);
      api.references
        .graph(project.id)
        .then(setGraph)
        .catch((e) => setError(e.message))
        .finally(() => setGraphLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, project.id]);

  // BibTeX/RIS 导出
  const doExport = async (format: 'bibtex' | 'ris') => {
    try {
      const text = await api.references.exportReferences(project.id, format);
      downloadText(
        `${project.name || 'references'}.${format === 'bibtex' ? 'bib' : 'ris'}`,
        text,
        format === 'bibtex' ? 'application/x-bibtex;charset=utf-8' : 'application/x-research-info-systems;charset=utf-8',
      );
      toast('success', format === 'bibtex' ? '已导出 BibTeX' : '已导出 RIS');
    } catch (e: any) {
      setError(e.message);
    }
  };

  // BibTeX 导入（粘贴或选文件）
  const onPickBibFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setBibText(String(reader.result || ''));
    reader.readAsText(f);
  };

  const doImportBibtex = async () => {
    if (!bibText.trim()) {
      setError('请粘贴或选择 BibTeX 文件');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const res = await api.references.importBibtex(project.id, bibText);
      toast('success', `导入完成：新增 ${res.imported} 条，跳过重复 ${res.skipped} 条`);
      setBibText('');
      setShowImport(false);
      setRefs(await api.references.list(project.id));
      setGraph(null); // 下次进入网络 Tab 时重新聚合
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const results = await api.references.search(query.trim(), 8, project.id);
      setHits(results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const addManual = async () => {
    if (!addTitle.trim()) {
      setError('文献标题必填');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const r = await api.references.create(project.id, {
        title: addTitle.trim(),
        authors: addAuthors.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        year: addYear ? Number(addYear) : undefined,
        venue: addVenue.trim(),
        doi: addDoi.trim(),
        abstract: addAbstract.trim(),
      });
      toast('success', '文献已加入文献库');
      setRefs((s) => (s.some((x) => x.id === r.id) ? s : [r, ...s]));
      setAddTitle(''); setAddAuthors(''); setAddYear(''); setAddVenue(''); setAddDoi(''); setAddAbstract('');
      setShowAdd(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const importOne = async (hit: Reference) => {
    try {
      const r = await api.references.create(project.id, hit);
      toast('success', '文献已加入文献库');
      setRefs((s) => (s.some((x) => x.id === r.id) ? s : [r, ...s]));
      setImported((s) => new Set(s).add(r.title));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const importAll = async () => {
    const pending = hits.filter((h) => !imported.has(h.title));
    if (pending.length === 0) return;
    try {
      const created = await api.references.importMany(project.id, pending);
      setRefs((s) => [...created.filter((r) => !s.some((x) => x.id === r.id)), ...s]);
      setImported((s) => new Set([...s, ...pending.map((p) => p.title)]));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeRef = async (id: string) => {
    await api.references.remove(id);
    setRefs((s) => s.filter((r) => r.id !== id));
  };

  const runSummary = async () => {
    setBusy('summary');
    setError('');
    try {
      setSummary(await api.references.summarize(project.id, query || project.name));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runExtract = async () => {
    setBusy('extract');
    setError('');
    try {
      setExtracted(await api.references.extract(project.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runEvidence = async () => {
    if (!question.trim()) return;
    setBusy('evidence');
    setError('');
    try {
      setEvidence(await api.references.evidence(project.id, question.trim()));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runDeepDive = async (refId?: string) => {
    const id = refId || deepDiveRef;
    if (!id) {
      setError('请先选择要精读的文献');
      return;
    }
    setBusy('deepdive');
    setError('');
    try {
      setDeepDive(await api.references.deepDive(project.id, id));
      toast('success', '文献精读完成');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runGap = async () => {
    setBusy('gap');
    setError('');
    try {
      setGapResult(await api.references.gap(project.id, gapTopic.trim() || project.name));
      toast('success', '研究缺口分析完成');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runCompare = async () => {
    const chosen = refs.filter((r) => selectedRefs.has(r.id));
    if (chosen.length < 2) {
      setError('请至少选择两篇文献进行对比');
      return;
    }
    setBusy('compare');
    setError('');
    try {
      setComparison(await api.research.comparison(chosen.map((r) => ({ title: r.title, year: r.year, venue: r.venue, abstract: r.abstract || '' }))));
      toast('success', '文献对比完成');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  /* ================= 系统综述：筛选 ================= */
  const screenMap = useMemo(() => new Map(screenItems.map((s) => [s.referenceId, s])), [screenItems]);

  const refreshScreen = async () => {
    try {
      setScreenItems(await api.references.screenList(project.id));
    } catch {
      /* 静默降级 */
    }
  };

  const doScreen = async (refId: string, status: ScreenStatus, reason = '') => {
    try {
      await api.references.screen(project.id, refId, status, reason);
      refreshScreen();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doScreenBulk = async (status: ScreenStatus) => {
    if (screenSelected.size === 0) return;
    setScreenBusy(true);
    try {
      await api.references.screenBulk(project.id, [...screenSelected], status);
      refreshScreen();
      toast('success', `已批量${SCREEN_META[status].label} ${screenSelected.size} 篇`);
      setScreenSelected(new Set());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScreenBusy(false);
    }
  };

  const filteredScreenItems = useMemo(
    () => (screenFilter === 'all' ? screenItems : screenItems.filter((s) => s.status === screenFilter)),
    [screenItems, screenFilter],
  );
  const allFilteredSelected = filteredScreenItems.length > 0 && filteredScreenItems.every((s) => screenSelected.has(s.referenceId));

  /* ================= 系统综述：编码抽取表 ================= */
  const loadExtraction = async () => {
    setExtLoading(true);
    setExtError('');
    try {
      const [fields, table] = await Promise.all([
        api.references.extractionFields(project.id),
        api.references.extractionTable(project.id),
      ]);
      setExtFields(fields);
      setExtTable(table);
    } catch (e: any) {
      setExtError(e.message);
      setExtFields([]);
      setExtTable(null);
    } finally {
      setExtLoading(false);
    }
  };

  useEffect(() => {
    if (showExtraction) loadExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExtraction, project.id]);

  const addField = async () => {
    if (!newFieldKey.trim() || !newFieldLabel.trim()) {
      setExtError('字段 key 与显示名必填');
      return;
    }
    try {
      const opts = newFieldKind === 'select' ? newFieldOptions.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
      await api.references.addExtractionField(project.id, newFieldKey.trim(), newFieldLabel.trim(), newFieldKind, opts);
      setNewFieldKey(''); setNewFieldLabel(''); setNewFieldOptions('');
      loadExtraction();
      toast('success', '抽取字段已添加');
    } catch (e: any) {
      setExtError(e.message);
    }
  };

  const removeField = async (id: string) => {
    try {
      await api.references.removeExtractionField(id);
      loadExtraction();
      toast('info', '字段已删除');
    } catch (e: any) {
      setExtError(e.message);
    }
  };

  const saveExtValue = async (fieldId: string, referenceId: string, value: string) => {
    try {
      await api.references.setExtractionValue(fieldId, referenceId, value);
    } catch (e: any) {
      setExtError(e.message);
    }
  };

  /* ================= 可视化聚合 ================= */
  const authors = (a: string) => jsonText<string[]>(a, []).join(', ') || '佚名';
  const stanceTone = (s: string) => (s.includes('支持') && !s.includes('部分') ? 'green' : s.includes('矛盾') ? 'red' : s.includes('部分') ? 'amber' : 'slate');

  // 证据综合：共识度 SegBar（按 stance 归类计数）
  const consensus = useMemo(() => {
    if (!evidence) return [];
    const buckets = { support: 0, partial: 0, conflict: 0, neutral: 0 };
    evidence.stances.forEach((s) => {
      if (s.stance.includes('支持') && !s.stance.includes('部分')) buckets.support += s.count;
      else if (s.stance.includes('矛盾')) buckets.conflict += s.count;
      else if (s.stance.includes('部分')) buckets.partial += s.count;
      else buckets.neutral += s.count;
    });
    return [
      { label: '支持', value: buckets.support, color: '#10b981', hint: `证据支持该论断的文献 ${buckets.support} 篇` },
      { label: '部分支持', value: buckets.partial, color: '#f59e0b', hint: `部分支持 / 有条件支持 ${buckets.partial} 篇` },
      { label: '矛盾', value: buckets.conflict, color: '#f87171', hint: `文献结论相互矛盾 ${buckets.conflict} 篇` },
      { label: '中立/不足', value: buckets.neutral, color: '#94a3b8', hint: `证据不足或中立 ${buckets.neutral} 篇` },
    ].filter((s) => s.value > 0);
  }, [evidence]);

  // 文献库：年份分布 Top 10
  const yearDist = useMemo(() => {
    const m = new Map<string, number>();
    refs.forEach((r) => {
      const y = r.year ? String(r.year) : '未知';
      m.set(y, (m.get(y) || 0) + 1);
    });
    return [...m.entries()]
      .map(([label, value]) => ({ label, value, hint: `${label} 年：${value} 篇` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [refs]);

  // 文献库：高被引 Top 8
  const topCited = useMemo(() => {
    return [...refs]
      .filter((r) => r.citationCount > 0)
      .sort((a, b) => b.citationCount - a.citationCount)
      .slice(0, 8)
      .map((r) => ({
        label: r.title.length > 36 ? r.title.slice(0, 36) + '…' : r.title,
        value: r.citationCount,
        sub: `${r.year || 'n.d.'}·${(r.venue || '').slice(0, 14)}`,
        hint: r.title,
      }));
  }, [refs]);

  // 文献库：venue 分布 Donut（Top5 + 其他，无 venue 归未标注）
  const venueDist = useMemo(() => {
    const m = new Map<string, number>();
    refs.forEach((r) => {
      const v = r.venue?.trim() || '未标注';
      m.set(v, (m.get(v) || 0) + 1);
    });
    const entries = [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const top = entries.slice(0, 5);
    const rest = entries.slice(5);
    if (rest.length) top.push({ label: '其他', value: rest.reduce((s, x) => s + x.value, 0) });
    return top;
  }, [refs]);

  return (
    <div className="max-w-6xl mx-auto">
      <ErrorBox message={error} />

      {/* 检索区（本地文献库，已移除国外在线源） */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-2.5 text-slate-700 dark:text-slate-200 font-semibold">
          <FlaskConical size={15} className="brand-gradient-text" /> 文献调研
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            className="flex-1 min-w-52"
            placeholder="在我的文献库中检索标题 / 作者 / 摘要，如：图神经网络"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <Button onClick={search} disabled={searching || !query.trim()}>
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} 检索
          </Button>
          <Button variant="outline" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={15} /> 手动添加文献
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">这里检索的是你已录入的本地文献库（离线可用，不联网）。还没有文献？试试：粘贴 DOI、导入 BibTeX、或手动录入</div>

        {/* 手动添加表单 */}
        {showAdd && (
          <div className="mt-3 p-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10 space-y-2">
            <div className="grid md:grid-cols-2 gap-2">
              <Input placeholder="标题 *" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
              <Input placeholder="作者（逗号分隔）" value={addAuthors} onChange={(e) => setAddAuthors(e.target.value)} />
              <Input placeholder="年份（可选）" value={addYear} onChange={(e) => setAddYear(e.target.value)} />
              <Input placeholder="期刊 / 会议（可选）" value={addVenue} onChange={(e) => setAddVenue(e.target.value)} />
              <Input placeholder="DOI（可选）" value={addDoi} onChange={(e) => setAddDoi(e.target.value)} />
            </div>
            <Textarea rows={2} placeholder="摘要（可选）" value={addAbstract} onChange={(e) => setAddAbstract(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={addManual} disabled={adding || !addTitle.trim()}>
                {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 保存到文献库
              </Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </div>
        )}
      </Card>

      {/* 检索结果 */}
      {hits.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">检索结果（{hits.length} 篇）</span>
            <Button variant="success" className="text-xs" onClick={importAll}>
              <Plus size={14} /> 全部导入文献库
            </Button>
          </div>
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {hits.map((h, i) => (
              <div key={i} className="flex items-start gap-3 border border-slate-100 dark:border-slate-800 rounded-lg p-3 hover:border-teal-300 hover:shadow-[0_2px_10px_-4px_rgba(13,148,136,0.18)] transition-all duration-150">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{h.title}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {authors(h.authors)} · {h.year || 'n.d.'} · {h.venue}
                    {h.doi && <span className="text-emerald-600"> · DOI:{h.doi}</span>}
                    {h.citationCount ? ` · 被引 ${h.citationCount}` : ''}
                  </div>
                  {h.abstract && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{h.abstract}</div>}
                  <div className="mt-1.5">
                    <Badge tone="blue">{h.source}</Badge>
                  </div>
                </div>
                <Button variant={imported.has(h.title) ? 'ghost' : 'outline'} className="text-xs shrink-0" disabled={imported.has(h.title)} onClick={() => importOne(h)}>
                  {imported.has(h.title) ? '已导入' : '导入'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 工具 Tab + 文献库（移动端横向滚动） */}
      <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${
              tool === t.key ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800'
            }`}
          >
            <t.icon size={14} /> {t.label}
            <span className="text-[10px] text-slate-400 dark:text-slate-500 hidden lg:inline">({t.hint})</span>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 文献库 */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <FlaskConical size={14} /> 文献库（{refs.length} 条）
            </span>
            {selectedRefs.size > 0 && (
              <Badge tone="teal">已选 {selectedRefs.size} 篇（可用于对比）</Badge>
            )}
          </div>
          {/* 文献交换工具区：导出 BibTeX/RIS、导入 BibTeX */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Button variant="outline" className="text-xs h-7 px-2" disabled={refs.length === 0} onClick={() => doExport('bibtex')}>
              <FileDown size={12} /> 导出 BibTeX
            </Button>
            <Button variant="outline" className="text-xs h-7 px-2" disabled={refs.length === 0} onClick={() => doExport('ris')}>
              <FileDown size={12} /> 导出 RIS
            </Button>
            <Button variant="outline" className="text-xs h-7 px-2" onClick={() => setShowImport((v) => !v)}>
              <Upload size={12} /> 导入 BibTeX
            </Button>
          </div>
          {showImport && (
            <div className="mb-3 p-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 space-y-2">
              <Textarea
                rows={5}
                placeholder={'粘贴 BibTeX 内容，例如：\n@article{key,\n  title = {Attention Is All You Need},\n  author = {Vaswani, A.},\n  year = {2017}\n}'}
                value={bibText}
                onChange={(e) => setBibText(e.target.value)}
              />
              <input type="file" accept=".bib,.txt,text/plain" onChange={onPickBibFile} className="text-xs text-slate-500 dark:text-slate-400" />
              <div className="flex gap-2">
                <Button onClick={doImportBibtex} disabled={importing || !bibText.trim()}>
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 导入到文献库
                </Button>
                <Button variant="ghost" onClick={() => setShowImport(false)}>取消</Button>
              </div>
            </div>
          )}
          {refs.length === 0 ? (
            <Empty text="文献库为空。三步获得第一批文献：① 粘贴 DOI（自动识别去重）② 导入 BibTeX（文件/粘贴）③ 手动添加文献或上传全文到知识库" />
          ) : (
            <>
              {/* 文献库统计概览 */}
              <div className="mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">年份分布 Top 10</div>
                    <HBar items={yearDist} barHeight={6} />
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">来源 / venue 分布</div>
                    <Donut segments={venueDist} size={80} thickness={11} centerValue={String(refs.length)} centerLabel="篇总量" />
                  </div>
                </div>
                {topCited.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">高被引 Top {topCited.length}</div>
                    <HBar items={topCited} barHeight={6} />
                  </div>
                )}
              </div>

              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {refs.map((r) => {
                  const sc = screenMap.get(r.id);
                  const scStatus: ScreenStatus = sc?.status ?? 'pending';
                  return (
                    <div key={r.id} className="border border-slate-100 dark:border-slate-800 rounded-lg p-2.5 flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1.5 accent-teal-600"
                        checked={selectedRefs.has(r.id)}
                        onChange={() => setSelectedRefs((s0) => { const n = new Set(s0); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                        title="勾选后可用于文献对比"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-1.5">
                          <div className="text-sm text-slate-800 dark:text-slate-100">{r.title}</div>
                          {scStatus !== 'pending' && <Badge tone={SCREEN_META[scStatus].tone}>{SCREEN_META[scStatus].label}</Badge>}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {authors(r.authors)} · {r.year || 'n.d.'} · {r.venue}
                          {r.doi && <span className="text-emerald-600"> · DOI:{r.doi}</span>}
                        </div>
                        {/* 筛选状态按钮组 */}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(['included', 'excluded', 'uncertain'] as const).map((st) => {
                            const active = scStatus === st;
                            const toneCls =
                              st === 'included'
                                ? active
                                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-emerald-300'
                                : st === 'excluded'
                                ? active
                                  ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-300'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-rose-300'
                                : active
                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-amber-300';
                            return (
                              <button
                                key={st}
                                onClick={() => doScreen(r.id, st)}
                                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${toneCls}`}
                                title={`标记为${SCREEN_META[st].label}（系统综述筛选）`}
                              >
                                {SCREEN_META[st].label}
                              </button>
                            );
                          })}
                        </div>
                        {scStatus !== 'pending' && (
                          <Input
                            className="mt-1.5 text-xs h-7"
                            placeholder="筛选理由（可选，失焦保存）"
                            defaultValue={sc?.reason ?? ''}
                            onBlur={(e) => doScreen(r.id, scStatus, e.target.value.trim())}
                          />
                        )}
                      </div>
                      <button
                        className="text-slate-400 hover:text-teal-600 shrink-0 mt-0.5"
                        title="AI 深度精读这篇文献"
                        onClick={() => {
                          setTool('deepdive');
                          setDeepDiveRef(r.id);
                          setDeepDive(null);
                          runDeepDive(r.id);
                        }}
                      >
                        <BookOpenCheck size={14} />
                      </button>
                      <button className="text-slate-300 hover:text-rose-500" onClick={() => removeRef(r.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        {/* 工具输出区 */}
        <Card className="p-4">
          {tool === 'summary' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">AI 文献综述</span>
                <Button variant="outline" className="text-xs" onClick={runSummary} disabled={busy === 'summary' || refs.length === 0}>
                  {busy === 'summary' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 生成
                </Button>
              </div>
              {busy === 'summary' ? (
                <Spinner label="生成综述中…" />
              ) : summary ? (
                <div className="text-sm leading-relaxed whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 max-h-[440px] overflow-y-auto">{summary}</div>
              ) : (
                <Empty text="基于文献库自动撰写结构化综述：按主题组织 + 每处观点绑定 [Ref:N] 文献 + 研究空白" />
              )}
            </>
          )}

          {tool === 'extract' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">结构化提取（方法/结果/贡献/局限）</span>
                <Button variant="outline" className="text-xs" onClick={runExtract} disabled={busy === 'extract' || refs.length === 0}>
                  {busy === 'extract' ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />} 提取
                </Button>
              </div>
              {busy === 'extract' ? (
                <Spinner label="提取文献结构化信息…" />
              ) : extracted.length > 0 ? (
                <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left">文献</th>
                        <th className="px-2 py-2 text-left">方法</th>
                        <th className="px-2 py-2 text-left">结果</th>
                        <th className="px-2 py-2 text-left">贡献</th>
                        <th className="px-2 py-2 text-left">局限</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extracted.map((p, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                          <td className="px-2 py-2 max-w-[180px]">
                            <div className="font-medium text-slate-700 dark:text-slate-200 leading-snug">{p.title}</div>
                            <div className="text-slate-400 dark:text-slate-500 mt-0.5">{p.year || 'n.d.'}</div>
                          </td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{p.method}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{p.results}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{p.contribution}</td>
                          <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{p.limitations}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty text="对文献库做系统综述式结构化提取：方法、关键结果、核心贡献、局限，生成可对比的表格" />
              )}
            </>
          )}

          {tool === 'deepdive' && (
            <>
              <div className="flex gap-2 mb-3">
                <Select
                  className="flex-1 text-xs"
                  options={[{ value: '', label: '选择要精读的文献…' }, ...refs.map((r) => ({ value: r.id, label: r.title }))]}
                  value={deepDiveRef}
                  onChange={(v) => {
                    setDeepDiveRef(v);
                    setDeepDive(null);
                    if (v) runDeepDive(v);
                  }}
                />
                <Button variant="outline" className="text-xs shrink-0" onClick={() => runDeepDive()} disabled={busy === 'deepdive' || !deepDiveRef}>
                  {busy === 'deepdive' ? <Loader2 size={13} className="animate-spin" /> : <BookOpenCheck size={13} />} 精读
                </Button>
              </div>
              {busy === 'deepdive' ? (
                <Spinner label="AI 深度解读文献…" />
              ) : deepDive ? (
                <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{deepDive.oneLine}</div>
                  <div className="rounded-lg bg-teal-50/50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900 p-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{deepDive.takeaway}</div>
                  {[
                    ['研究问题', deepDive.researchQuestion],
                    ['研究动机', deepDive.motivation],
                    ['研究方法', deepDive.method],
                  ].map(([label, val]) => (
                    <div key={label} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                      <div className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">{label}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{val}</div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                    <div className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">关键发现</div>
                    <ul className="list-disc pl-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                      {deepDive.keyFindings.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-amber-100 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-900/10 p-3">
                    <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">局限</div>
                    <ul className="list-disc pl-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                      {deepDive.limitations.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                    <div className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">未来工作</div>
                    <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{deepDive.futureWork}</div>
                  </div>
                </div>
              ) : (
                <Empty text="选择一篇文献，AI 深度解剖：研究问题 / 动机 / 方法 / 关键发现 / 局限 / 未来工作" />
              )}
            </>
          )}

          {tool === 'gap' && (
            <>
              <div className="flex gap-2 mb-3">
                <Input placeholder="研究主题（留空则用项目名），如：大语言模型评估" value={gapTopic} onChange={(e) => setGapTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runGap()} />
                <Button variant="outline" className="text-xs shrink-0" onClick={runGap} disabled={busy === 'gap' || refs.length === 0}>
                  {busy === 'gap' ? <Loader2 size={13} className="animate-spin" /> : <Lightbulb size={13} />} 定位缺口
                </Button>
              </div>
              {busy === 'gap' ? (
                <Spinner label="分析研究缺口…" />
              ) : gapResult ? (
                <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                  <div className="rounded-lg bg-teal-50/50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900 p-3">
                    <div className="text-xs font-medium text-teal-700 dark:text-teal-300 mb-1">推荐选题</div>
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{gapResult.recommendedTopic}</div>
                  </div>
                  {/* 按可行性三栏看板 */}
                  <div className="grid md:grid-cols-3 gap-2">
                    {(['高', '中', '低'] as const).map((level) => {
                      const items = gapResult.gaps.filter((g) => g.feasibility === level);
                      const headCls =
                        level === '高'
                          ? 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                          : level === '中'
                          ? 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900'
                          : 'text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900';
                      return (
                        <div key={level} className="rounded-lg border border-slate-100 dark:border-slate-800 overflow-hidden">
                          <div className={`px-2.5 py-1.5 text-xs font-semibold border-b bg-slate-50/60 dark:bg-slate-900/40 ${headCls}`}>
                            可行性{level} · {items.length}
                          </div>
                          <div className="p-2 space-y-2">
                            {items.length === 0 ? (
                              <div className="text-[11px] text-slate-400 dark:text-slate-500 py-3 text-center">暂无</div>
                            ) : (
                              items.map((g, i) => (
                                <div key={i} className="text-xs rounded-md bg-slate-50 dark:bg-slate-900/40 p-2">
                                  <div className="font-medium text-slate-700 dark:text-slate-200 leading-snug">{g.gap}</div>
                                  <div className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"><span className="text-teal-600 dark:text-teal-400">依据：</span>{g.evidence}</div>
                                  <div className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"><span className="text-teal-600 dark:text-teal-400">切入点：</span>{g.opportunity}</div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <Empty text="基于文献库定位未被充分研究的子问题（Research Gap），并给出可行选题建议与可行性评估" />
              )}
            </>
          )}

          {tool === 'compare' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">多文献横向对比（研究问题/方法/结论/局限）</span>
                <Button variant="outline" className="text-xs" onClick={runCompare} disabled={busy === 'compare' || selectedRefs.size < 2}>
                  {busy === 'compare' ? <Loader2 size={13} className="animate-spin" /> : <Table2 size={13} />} 生成对比表
                </Button>
              </div>
              {busy === 'compare' ? (
                <Spinner label="AI 横向对比文献…" />
              ) : comparison ? (
                <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">{comparison.summary}</div>
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left">文献</th>
                        <th className="px-2 py-2 text-left">研究问题</th>
                        <th className="px-2 py-2 text-left">方法</th>
                        <th className="px-2 py-2 text-left">主要结论</th>
                        <th className="px-2 py-2 text-left">局限</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                          <td className="px-2 py-2 max-w-[150px] font-medium text-slate-700 dark:text-slate-200">{r.paper}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.研究问题}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.方法}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.主要结论}</td>
                          <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{r.局限}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty text="勾选左侧文献库 2 篇以上文献（复选框），AI 生成研究问题 / 方法 / 结论 / 局限的横向对比表" />
              )}
            </>
          )}

          {tool === 'evidence' && (
            <>
              <div className="flex gap-2 mb-3">
                <Input placeholder="输入研究问题，如：大语言模型能否有效评测？" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runEvidence()} />
                <Button variant="outline" className="text-xs shrink-0" onClick={runEvidence} disabled={busy === 'evidence' || !question.trim() || refs.length === 0}>
                  {busy === 'evidence' ? <Loader2 size={13} className="animate-spin" /> : <GitCompareArrows size={13} />} 综合证据
                </Button>
              </div>
              {busy === 'evidence' ? (
                <Spinner label="综合证据中…" />
              ) : evidence ? (
                <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
                  {/* 共识度 SegBar */}
                  {consensus.length > 0 && (
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 p-3">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">共识度概览（按 stance 归类文献计数）</div>
                      <SegBar segments={consensus} />
                    </div>
                  )}
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{evidence.summary}</div>
                  {evidence.stances.map((s, i) => (
                    <div key={i} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.claim}</div>
                        <Badge tone={stanceTone(s.stance)}>{s.stance} · {s.count} 篇</Badge>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.note}</div>
                      {s.refs.length > 0 && <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">依据：[Ref:{s.refs.join(', ')}]</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty text="Consensus 式证据综合：判断每个论断的证据强度（支持/部分支持/矛盾/证据不足）并统计文献数" />
              )}
            </>
          )}

          {tool === 'graph' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Network size={14} /> 引用网络（共引 + 去重）
                </span>
                <span className="text-[11px] text-slate-400">拖拽节点 · 点击选中 · 点空白取消</span>
              </div>
              {graphLoading ? (
                <Spinner label="聚合引用网络中…" />
              ) : !graph || graph.nodes.length === 0 ? (
                <Empty text="暂无文献，先去文献调研页录入 / 导入 BibTeX；网络将按文档共引与去重关系自动布局" />
              ) : (
                <ReferenceNetwork
                  graph={graph}
                  onViewRef={() => setTool('summary')}
                />
              )}
            </>
          )}
        </Card>
      </div>

      {/* ================= 系统综述：筛选队列 ================= */}
      <CollapsibleCard
        icon={<Filter size={16} className="text-teal-600" />}
        title="筛选队列（系统综述 PRISMA 筛选）"
        summary={`共 ${screenItems.length} 条 · 纳入 ${screenItems.filter((s) => s.status === 'included').length} / 排除 ${screenItems.filter((s) => s.status === 'excluded').length}`}
        open={showScreen}
        onToggle={() => setShowScreen((v) => !v)}
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Select
            className="text-xs w-40"
            value={screenFilter}
            onChange={(v) => setScreenFilter(v as 'all' | ScreenStatus)}
            options={[
              { value: 'all', label: `全部（${screenItems.length}）` },
              { value: 'pending', label: `待筛（${screenItems.filter((s) => s.status === 'pending').length}）` },
              { value: 'included', label: `纳入（${screenItems.filter((s) => s.status === 'included').length}）` },
              { value: 'excluded', label: `排除（${screenItems.filter((s) => s.status === 'excluded').length}）` },
              { value: 'uncertain', label: `不确定（${screenItems.filter((s) => s.status === 'uncertain').length}）` },
            ]}
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              className="accent-teal-600"
              checked={allFilteredSelected}
              onChange={() => {
                setScreenSelected((prev) => {
                  const next = new Set(prev);
                  if (allFilteredSelected) filteredScreenItems.forEach((s) => next.delete(s.referenceId));
                  else filteredScreenItems.forEach((s) => next.add(s.referenceId));
                  return next;
                });
              }}
            />
            全选当前（已选 {screenSelected.size}）
          </label>
          <div className="ml-auto flex gap-2">
            <Button variant="success" className="text-xs" disabled={screenSelected.size === 0 || screenBusy} onClick={() => doScreenBulk('included')}>
              {screenBusy ? <Loader2 size={13} className="animate-spin" /> : null} 一键纳入
            </Button>
            <Button variant="danger" className="text-xs" disabled={screenSelected.size === 0 || screenBusy} onClick={() => doScreenBulk('excluded')}>
              {screenBusy ? <Loader2 size={13} className="animate-spin" /> : null} 一键排除
            </Button>
          </div>
        </div>

        {filteredScreenItems.length === 0 ? (
          <ChartEmpty title="暂无筛选记录" hint="在左侧文献库点击「纳入/排除/不确定」按钮，即可把文献加入筛选队列" />
        ) : (
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {filteredScreenItems.map((s) => (
              <div key={s.id} className="flex items-start gap-2.5 border border-slate-100 dark:border-slate-800 rounded-lg p-2.5">
                <input
                  type="checkbox"
                  className="mt-1 accent-teal-600"
                  checked={screenSelected.has(s.referenceId)}
                  onChange={() =>
                    setScreenSelected((prev) => {
                      const n = new Set(prev);
                      n.has(s.referenceId) ? n.delete(s.referenceId) : n.add(s.referenceId);
                      return n;
                    })
                  }
                  title="勾选后可批量操作"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 dark:text-slate-100 leading-snug">{s.title}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {s.year || 'n.d.'} · {s.venue || '未标注'}
                  </div>
                  {s.reason && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">理由：{s.reason}</div>}
                </div>
                <Badge tone={SCREEN_META[s.status].tone}>{SCREEN_META[s.status].label}</Badge>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* ================= 系统综述：编码抽取表 ================= */}
      <CollapsibleCard
        icon={<ClipboardList size={16} className="text-teal-600" />}
        title="编码抽取表（跨文献数据矩阵）"
        summary={extTable ? `${extFields.length} 字段 · ${extTable.rows.length} 篇` : '定义抽取字段并逐篇编码'}
        open={showExtraction}
        onToggle={() => setShowExtraction((v) => !v)}
      >
        <ErrorBox message={extError} />

        {/* 字段管理 */}
        <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3 mb-3">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">抽取字段管理</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {extFields.length === 0 ? (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">尚未定义字段，下方添加第一个编码字段</span>
            ) : (
              extFields.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 text-[11px]">
                  {f.label}
                  <span className="text-slate-400">({f.kind})</span>
                  <button className="text-slate-400 hover:text-rose-500" title="删除字段" onClick={() => removeField(f.id)}>
                    <X size={11} />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="grid md:grid-cols-4 gap-2">
            <Input placeholder="字段 key（英文标识，如 sampleSize）" value={newFieldKey} onChange={(e) => setNewFieldKey(e.target.value)} className="text-xs" />
            <Input placeholder="显示名（如 样本量）" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} className="text-xs" />
            <Select
              className="text-xs"
              value={newFieldKind}
              onChange={(v) => setNewFieldKind(v as 'text' | 'select')}
              options={[
                { value: 'text', label: '文本输入' },
                { value: 'select', label: '下拉选择' },
              ]}
            />
            {newFieldKind === 'select' && (
              <Input placeholder="选项（逗号分隔，如  RCT,队列,综述）" value={newFieldOptions} onChange={(e) => setNewFieldOptions(e.target.value)} className="text-xs" />
            )}
            <Button variant="outline" className="text-xs" onClick={addField} disabled={!newFieldKey.trim() || !newFieldLabel.trim()}>
              <Plus size={13} /> 添加字段
            </Button>
          </div>
        </div>

        {/* 矩阵表 */}
        {extLoading ? (
          <Spinner label="加载抽取矩阵…" />
        ) : !extTable || extTable.rows.length === 0 || extFields.length === 0 ? (
          <ChartEmpty title="暂无编码数据" hint="先在上方添加抽取字段，系统将以文献为行、字段为列生成可编辑矩阵" />
        ) : (
          <div className="overflow-auto rounded-lg border border-slate-100 dark:border-slate-800 max-h-[420px]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left min-w-[200px]">文献</th>
                  {extFields.map((f) => (
                    <th key={f.id} className="px-2 py-2 text-left min-w-[120px]">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extTable.rows.map((row) => (
                  <tr key={row.referenceId} className="border-t border-slate-100 dark:border-slate-800 align-top">
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-700 dark:text-slate-200 leading-snug max-w-[200px] truncate" title={row.title}>{row.title}</div>
                      <div className="text-slate-400 dark:text-slate-500 mt-0.5">{row.year || 'n.d.'} · {row.venue || '未标注'}</div>
                    </td>
                    {extFields.map((f) => {
                      const val = row.values[f.key] ?? row.values[f.id] ?? '';
                      return (
                        <td key={f.id} className="px-2 py-1.5">
                          {f.kind === 'select' ? (
                            <select
                              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-xs outline-none focus:border-teal-500"
                              value={val}
                              onChange={(e) => saveExtValue(f.id, row.referenceId, e.target.value)}
                            >
                              <option value="">—</option>
                              {f.options.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              className="text-xs h-7"
                              placeholder="…"
                              defaultValue={val}
                              onBlur={(e) => saveExtValue(f.id, row.referenceId, e.target.value)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}
