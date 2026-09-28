import { useEffect, useState } from 'react';
import { BookOpenCheck, Download, FlaskConical, GitCompareArrows, Lightbulb, ListChecks, Loader2, Plus, Search, Table2, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { DeepDiveResult, EvidenceResult, ExtractedPaper, GapResult, PaperComparisonResult, Project, Reference } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Input, Select, Spinner, jsonText } from '../components/ui';

type Tool = 'summary' | 'extract' | 'evidence' | 'deepdive' | 'gap' | 'compare';

const TOOLS: { key: Tool; label: string; icon: typeof ListChecks; hint: string }[] = [
  { key: 'summary', label: '文献综述', icon: Download, hint: 'STORM 式结构化综述' },
  { key: 'extract', label: '结构化提取', icon: ListChecks, hint: 'Elicit 式对比表' },
  { key: 'evidence', label: '证据综合', icon: GitCompareArrows, hint: 'Consensus 式共识度' },
  { key: 'deepdive', label: '单篇精读', icon: BookOpenCheck, hint: 'Lateral 式论文解剖' },
  { key: 'gap', label: '研究缺口', icon: Lightbulb, hint: '科研选题定位' },
  { key: 'compare', label: '文献对比', icon: Table2, hint: '多篇横向对比表' },
];

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
  const toast = useContext(ToastContext);

  useEffect(() => {
    api.references.list(project.id).then(setRefs).catch((e) => setError(e.message));
  }, [project.id]);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const results = await api.references.search(query.trim(), 8);
      setHits(results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching(false);
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

  const authors = (a: string) => jsonText<string[]>(a, []).join(', ') || '佚名';
  const stanceTone = (s: string) => (s.includes('支持') && !s.includes('部分') ? 'green' : s.includes('矛盾') ? 'red' : s.includes('部分') ? 'amber' : 'slate');

  return (
    <div className="max-w-6xl mx-auto">
      <ErrorBox message={error} />

      {/* 检索区 */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-2.5 text-slate-700 dark:text-slate-200 font-semibold">
          <FlaskConical size={15} className="brand-gradient-text" /> 文献调研
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="输入研究方向，如：graph neural network survey"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <Button onClick={search} disabled={searching || !query.trim()}>
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} 检索
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">对接 OpenAlex · arXiv · Semantic Scholar · CrossRef 多源并查（真实文献，含 DOI 可追溯）</div>
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

      {/* 工具 Tab + 文献库 */}
      <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-800">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px ${
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
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <FlaskConical size={14} /> 文献库（{refs.length} 条）
            </span>
            {selectedRefs.size > 0 && (
              <Badge tone="teal">已选 {selectedRefs.size} 篇（可用于对比）</Badge>
            )}
          </div>
          {refs.length === 0 ? (
            <Empty text="文献库为空：检索后导入，或到全自动流水线自动收集" />
          ) : (
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              {refs.map((r) => (
                <div key={r.id} className="border border-slate-100 dark:border-slate-800 rounded-lg p-2.5 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1.5 accent-teal-600"
                    checked={selectedRefs.has(r.id)}
                    onChange={() => setSelectedRefs((s0) => { const n = new Set(s0); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                    title="勾选后可用于文献对比"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-800 dark:text-slate-100">{r.title}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {authors(r.authors)} · {r.year || 'n.d.'} · {r.venue}
                      {r.doi && <span className="text-emerald-600"> · DOI:{r.doi}</span>}
                    </div>
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
              ))}
            </div>
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
                  {gapResult.gaps.map((g, i) => (
                    <div key={i} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">缺口 {i + 1}：{g.gap}</div>
                        <Badge tone={g.feasibility === '高' ? 'green' : g.feasibility === '中' ? 'amber' : 'red'}>{g.feasibility}</Badge>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed"><span className="text-teal-600 dark:text-teal-400">依据：</span>{g.evidence}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"><span className="text-teal-600 dark:text-teal-400">切入点：</span>{g.opportunity}</div>
                    </div>
                  ))}
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
        </Card>
      </div>
    </div>
  );
}
