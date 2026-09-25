import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Gauge, Loader2, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project, QualityReport } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Select, Spinner, jsonText } from '../components/ui';

const DIMS = [
  { key: 'literature', label: '文献充分性' },
  { key: 'logic', label: '逻辑一致性' },
  { key: 'citation', label: '引用规范' },
  { key: 'language', label: '语言质量' },
  { key: 'novelty', label: '创新性' },
  { key: 'figures', label: '图表' },
  { key: 'format', label: '格式' },
];

function Radar({ scores }: { scores: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      tooltip: {},
      radar: {
        indicator: DIMS.map((d) => ({ name: d.label, max: 100 })),
        radius: '65%',
        splitArea: { areaStyle: { color: ['#f7f9fc', '#eef2f8'] } },
        axisName: { color: '#475569', fontSize: 11 },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: DIMS.map((d) => scores[d.key] ?? 0),
              name: '质量评分',
              areaStyle: { color: 'rgba(99,102,241,0.25)' },
              lineStyle: { color: '#6366f1', width: 2 },
              itemStyle: { color: '#6366f1' },
            },
          ],
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [scores]);

  return <div ref={ref} className="w-full h-64" />;
}

export function QualityPage({ project }: { project: Project }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState<string>('');
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<(QualityReport & { scoresObj: Record<string, number> }) | null>(null);
  const [history, setHistory] = useState<QualityReport[]>([]);
  const [selectedHist, setSelectedHist] = useState<(QualityReport & { scoresObj: Record<string, number> }) | null>(null);

  useEffect(() => {
    api.documents.list(project.id).then((d) => {
      setDocs(d);
      if (d.length) setDocId(d[0].id);
    });
  }, [project.id]);

  useEffect(() => {
    if (docId) api.quality.history(docId).then(setHistory).catch(() => setHistory([]));
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

  const current = selectedHist || report;

  return (
    <div className="max-w-5xl mx-auto">
      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge size={16} className="text-indigo-600" />
          <span className="text-sm font-semibold text-slate-700 mr-2">选择文档进行 7 维质量评分</span>
          <Select
            className="w-64"
            options={[{ value: '', label: '选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
            value={docId}
            onChange={setDocId}
          />
          <Button onClick={doReview} disabled={scoring || !docId}>
            {scoring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 开始评分
          </Button>
        </div>
        <div className="text-xs text-slate-400 mt-2">
          七维：文献充分性 · 逻辑一致性 · 引用规范 · 语言质量 · 创新性 · 图表 · 格式（0-100，总分取均值），结果持久化可历史对比
        </div>
      </Card>

      {current ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-semibold text-slate-700">当前评分</span>
              <Badge tone={current.totalScore >= 80 ? 'green' : current.totalScore >= 60 ? 'amber' : 'red'}>
                总分 {current.totalScore}/100
              </Badge>
            </div>
            <Radar scores={current.scoresObj} />
            <div className="text-xs text-slate-400 mt-1">{new Date(current.createdAt).toLocaleString()}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-slate-700 mb-2">改进建议</div>
            <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
              {current.feedback || '暂无反馈'}
            </div>
            {history.length > 1 && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <div className="text-xs font-medium text-slate-500 mb-2">历史评分（可对比）</div>
                <div className="space-y-1">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 border ${
                        selectedHist?.id === h.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-100 hover:border-indigo-200'
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
