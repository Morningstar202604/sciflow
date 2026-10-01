import { useEffect, useState, useContext } from 'react';
import { Gauge, Loader2, Sparkles, ListChecks } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project, QualityReport } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Select, Spinner, jsonText } from '../components/ui';
import { ToastContext } from '../App';
import { HBar, LineChart, ProgressRing } from '../components/charts';

const DIMS = [
  { key: 'literature', label: '文献充分性' },
  { key: 'logic', label: '逻辑一致性' },
  { key: 'citation', label: '引用规范' },
  { key: 'language', label: '语言质量' },
  { key: 'novelty', label: '创新性' },
  { key: 'figures', label: '图表' },
  { key: 'format', label: '格式' },
];

/** 自绘 SVG 雷达图（替代 ECharts，去掉 ~200KB 打包体积） */
function Radar({ scores }: { scores: Record<string, number> }) {
  const W = 300, H = 250, CX = W / 2, CY = 112, R = 82;
  const n = DIMS.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, v: number) => {
    const r = (v / 100) * R;
    return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))] as const;
  };
  const poly = (v: number) => Array.from({ length: n }, (_, i) => pt(i, v).join(',')).join(' ');
  const value = (i: number) => Math.round(scores[DIMS[i].key] ?? 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="7 维质量评分雷达图">
      {/* 网格：4 级同心多边形 */}
      {[25, 50, 75, 100].map((lv) => (
        <polygon key={lv} points={poly(lv)} fill="none" stroke="#e2e8f0" strokeWidth="1" className="dark:stroke-slate-700" />
      ))}
      {/* 轴线 */}
      {DIMS.map((_, i) => (
        <line key={i} x1={CX} y1={CY} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke="#e2e8f0" strokeWidth="1" className="dark:stroke-slate-700" />
      ))}
      {/* 数据多边形 */}
      <polygon points={poly(100)} fill="rgba(13,148,136,0.22)" stroke="var(--brand-500)" strokeWidth="2" />
      {/* 顶点 + 数值标签 */}
      {DIMS.map((d, i) => {
        const [x, y] = pt(i, value(i));
        const [lx, ly] = pt(i, 118);
        return (
          <g key={d.key}>
            <circle cx={x} cy={y} r="3.5" fill="var(--brand-400)" stroke="#fff" strokeWidth="1.5">
              <title>{`${d.label}：${value(i)}/100`}</title>
            </circle>
            <text x={lx} y={ly} textAnchor="middle" fontSize="10" fill="#475569" className="dark:fill-slate-300" fontWeight={600}>
              {d.label}
            </text>
            <text x={lx} y={ly + 11} textAnchor="middle" fontSize="10" fill="var(--brand-500)" fontWeight={700}>
              {value(i)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function QualityPage({ project }: { project: Project }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState<string>('');
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<(QualityReport & { scoresObj: Record<string, number> }) | null>(null);
  const [history, setHistory] = useState<QualityReport[]>([]);
  const [selectedHist, setSelectedHist] = useState<(QualityReport & { scoresObj: Record<string, number> }) | null>(null);
  /** 差距#7：把改进建议拆为可勾选待办（写入 review_comment）的导出态 */
  const [exporting, setExporting] = useState(false);
  const toast = useContext(ToastContext);

  useEffect(() => {
    api.documents.list(project.id).then((d) => {
      setDocs(d);
      if (d.length) setDocId(d[0].id);
    });
  }, [project.id]);

  useEffect(() => {
    if (docId)
      api.quality
        .history(docId)
        .then((h) => {
          setHistory(h);
          if (h.length) setSelectedHist({ ...h[0], scoresObj: jsonText<Record<string, number>>(h[0].scores, {}) });
        })
        .catch(() => setHistory([]));
  }, [docId]);

  const doReview = async () => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;
    setScoring(true);
    setError('');
    try {
      const r = await api.quality.review(doc.id, doc.title, doc.content);
      const full = { ...r, scoresObj: jsonText<Record<string, number>>(r.scores, {}) };
      setReport(full);
      setSelectedHist(full);
      setHistory(await api.quality.history(doc.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScoring(false);
    }
  };

  /** 差距#7：把最新 quality_report.feedback 按句拆成 review_comment 待办（幂等），供写作页/投稿页复用 */
  const doExportComments = async () => {
    if (!docId || exporting) return;
    setExporting(true);
    setError('');
    try {
      const res = await api.quality.exportComments(docId);
      if (res.created > 0) toast('success', `已拆出 ${res.created} 条改进待办（写入审稿意见表，写作/投稿页可见）`);
      else toast('info', `无新增：已有 ${res.existing} 条待办，未重复创建`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const current = selectedHist || report;

  return (
    <div className="max-w-5xl mx-auto">
      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge size={16} className="brand-gradient-text" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 mr-2">选择文档进行 7 维质量评分</span>
          <Select
            className="w-full sm:w-64"
            options={[{ value: '', label: '选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
            value={docId}
            onChange={setDocId}
          />
          <Button onClick={doReview} disabled={scoring || !docId}>
            {scoring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 开始评分
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          七维：文献充分性 · 逻辑一致性 · 引用规范 · 语言质量 · 创新性 · 图表 · 格式（0-100，总分取均值），结果持久化可历史对比
        </div>
      </Card>

      {current ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <ProgressRing value={current.totalScore} size={54} thickness={6} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">当前评分</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(current.createdAt).toLocaleString()}</div>
              </div>
              <div className="ml-auto">
                <Badge tone={current.totalScore >= 80 ? 'green' : current.totalScore >= 60 ? 'amber' : 'red'}>
                  总分 {current.totalScore}/100
                </Badge>
              </div>
            </div>
            <Radar scores={current.scoresObj} />
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">最需改进的维度</div>
              <HBar
                items={[...DIMS]
                  .map((d) => ({ label: d.label, value: Math.round(current.scoresObj[d.key] ?? 0) }))
                  .sort((a, b) => a.value - b.value)
                  .slice(0, 3)
                  .map((it) => ({ ...it, color: it.value < 60 ? '#f87171' : it.value < 75 ? '#f59e0b' : undefined }))}
              />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">改进建议</div>
              <Button
                variant="outline"
                className="text-xs"
                disabled={exporting || !current.feedback}
                onClick={doExportComments}
                title="把上方改进建议按句拆成可勾选待办，写入审稿意见表（写作页/投稿页复用）"
              >
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />} 拆为待办清单
              </Button>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
              {current.feedback || '暂无反馈'}
            </div>
            {history.length > 1 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">总分趋势（点击数据点可对比）</div>
                <LineChart
                  points={[...history]
                    .reverse()
                    .map((h) => ({ label: `${new Date(h.createdAt).getMonth() + 1}/${new Date(h.createdAt).getDate()}`, value: h.totalScore }))}
                  height={130}
                  onPointClick={(i) => {
                    const h = [...history].reverse()[i];
                    if (h) setSelectedHist({ ...h, scoresObj: jsonText<Record<string, number>>(h.scores, {}) });
                  }}
                />
                <div className="mt-2 space-y-1">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 border ${
                        selectedHist?.id === h.id ? 'border-teal-400 bg-teal-50 dark:bg-teal-500/10' : 'border-slate-100 dark:border-slate-800 hover:border-teal-300'
                      }`}
                      onClick={() => setSelectedHist({ ...h, scoresObj: jsonText<Record<string, number>>(h.scores, {}) })}
                    >
                      {new Date(h.createdAt).toLocaleString()} · 总分 {h.totalScore}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Empty text="评分结果将在这里展示（雷达图 + 总分 + 改进建议）" />
      )}
    </div>
  );
}
