import { useEffect, useState } from 'react';
import { Download, FlaskConical, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Project, Reference } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Input, Select, Spinner, Textarea, jsonText } from '../components/ui';

export function LiteraturePage({ project }: { project: Project }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<Reference[]>([]);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState('');

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

  const doSummarize = async () => {
    setSummarizing(true);
    setError('');
    try {
      const s = await api.references.summarize(project.id, query || project.name);
      setSummary(s);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSummarizing(false);
    }
  };

  const authors = (a: string) => jsonText<string[]>(a, []).join(', ') || '佚名';

  return (
    <div className="max-w-6xl mx-auto">
      <ErrorBox message={error} />

      {/* 检索区 */}
      <Card className="p-4 mb-4">
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
        <div className="text-xs text-slate-400 mt-2">
          对接 OpenAlex · arXiv · Semantic Scholar 三源并查（真实文献，含 DOI 可追溯），检索结果不会自动入库
        </div>
      </Card>

      {/* 检索结果 */}
      {hits.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">检索结果（{hits.length} 篇）</span>
            <Button variant="success" className="text-xs" onClick={importAll}>
              <Plus size={14} /> 全部导入文献库
            </Button>
          </div>
          <div className="space-y-2">
            {hits.map((h, i) => (
              <div key={i} className="flex items-start gap-3 border border-slate-100 rounded-lg p-3 hover:border-indigo-200">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">{h.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {authors(h.authors)} · {h.year || 'n.d.'} · {h.venue}
                    {h.doi && <span className="text-emerald-600"> · DOI:{h.doi}</span>}
                    {h.citationCount ? ` · 被引 ${h.citationCount}` : ''}
                  </div>
                  {h.abstract && <div className="text-xs text-slate-500 mt-1 line-clamp-2">{h.abstract}</div>}
                  <div className="mt-1.5">
                    <Badge tone="blue">{h.source}</Badge>
                  </div>
                </div>
                <Button
                  variant={imported.has(h.title) ? 'ghost' : 'outline'}
                  className="text-xs shrink-0"
                  disabled={imported.has(h.title)}
                  onClick={() => importOne(h)}
                >
                  {imported.has(h.title) ? '已导入' : '导入'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 文献库 + 综述 */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <FlaskConical size={14} /> 文献库（{refs.length} 条）
            </span>
            <Button variant="outline" className="text-xs" onClick={doSummarize} disabled={summarizing || refs.length === 0}>
              {summarizing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} AI 生成综述
            </Button>
          </div>
          {refs.length === 0 ? (
            <Empty text="文献库为空：检索后导入，或到全自动流水线自动收集" />
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {refs.map((r) => (
                <div key={r.id} className="border border-slate-100 rounded-lg p-2.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-800">{r.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {authors(r.authors)} · {r.year || 'n.d.'} · {r.venue}
                      {r.doi && <span className="text-emerald-600"> · DOI:{r.doi}</span>}
                    </div>
                  </div>
                  <button className="text-slate-300 hover:text-rose-500" onClick={() => removeRef(r.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-3">
            <FlaskConical size={14} /> AI 文献综述（只基于文献库真实文献）
          </span>
          {summarizing ? (
            <Spinner label="正在生成综述…" />
          ) : summary ? (
            <div className="prose-sm text-slate-700 whitespace-pre-wrap text-sm leading-relaxed bg-slate-50 rounded-lg p-3 max-h-[420px] overflow-y-auto">
              {summary}
            </div>
          ) : (
            <Empty text="点击「AI 生成综述」，基于已导入文献自动撰写结构化综述（每处观点绑定文献引用）" />
          )}
        </Card>
      </div>
    </div>
  );
}
