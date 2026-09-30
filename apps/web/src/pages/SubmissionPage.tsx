import { useEffect, useState } from 'react';
import { FilePen, Globe2, Library, Loader2, MessageSquareReply, Plus, Send, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Journal, JournalMatchResult, Project } from '../types';
import { Badge, Button, Card, ErrorBox, Input, Select, Spinner, Textarea } from '../components/ui';
import { HBar } from '../components/charts';

type Tab = 'journals' | 'cover' | 'reply';

export function SubmissionPage({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>('journals');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selDoc, setSelDoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');

  // 期刊推荐（结构化匹配）
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [match, setMatch] = useState<JournalMatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  // 期刊库
  const [lib, setLib] = useState<Journal[]>([]);
  const [libForm, setLibForm] = useState({ name: '', issn: '', publisher: '', quartile: '', if2024: '' });
  // Cover Letter
  const [journal, setJournal] = useState('');
  // 审稿回复
  const [reviewComments, setReviewComments] = useState('');
  const [responseHint, setResponseHint] = useState('');

  // 修复：拉取项目内文档，否则「选择项目内论文」下拉恒空
  useEffect(() => {
    api.documents.list(project.id).then(setDocs).catch(() => setDocs([]));
  }, [project.id]);

  // 期刊库加载
  useEffect(() => {
    api.submission.listJournals().then(setLib).catch(() => setLib([]));
  }, []);

  const loadLib = async () => {
    try {
      setLib(await api.submission.listJournals());
    } catch {
      /* 忽略 */
    }
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setOutput('');
    try {
      const result = await fn();
      setOutput(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runMatch = async () => {
    if (!title.trim()) {
      setError('请先填写论文标题（或从项目内文档选择）');
      return;
    }
    setMatching(true);
    setError('');
    setMatch(null);
    try {
      setMatch(await api.submission.journalsMatch(title, abstract));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setMatching(false);
    }
  };

  const addLibJournal = async () => {
    if (!libForm.name.trim()) return;
    try {
      await api.submission.addJournal({
        name: libForm.name.trim(),
        issn: libForm.issn.trim() || undefined,
        publisher: libForm.publisher.trim() || undefined,
        quartile: libForm.quartile.trim() || undefined,
        if2024: libForm.if2024 ? Number(libForm.if2024) : null,
      });
      setLibForm({ name: '', issn: '', publisher: '', quartile: '', if2024: '' });
      await loadLib();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pickDoc = (id: string) => {
    setSelDoc(id);
    const d = docs.find((x) => x.id === id);
    if (d) {
      setTitle(d.title);
      setAbstract((d.content || '').slice(0, 500));
    }
  };

  const TABS: { key: Tab; label: string; icon: typeof Globe2 }[] = [
    { key: 'journals', label: '期刊推荐', icon: Globe2 },
    { key: 'cover', label: 'Cover Letter', icon: FilePen },
    { key: 'reply', label: '审稿回复', icon: MessageSquareReply },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setOutput('');
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px ${
              tab === t.key ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        {tab === 'journals' && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">选择项目内论文（自动带入标题与摘要）</div>
              <Select
                className="w-full"
                options={[{ value: '', label: '从项目中选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
                value={selDoc}
                onChange={pickDoc}
              />
            </div>
            <Input placeholder="论文标题" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea rows={4} placeholder="论文摘要（可选，从文档自动带入或粘贴）" value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            <Button onClick={runMatch} disabled={matching}>
              {matching ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 智能匹配期刊
            </Button>
          </div>
        )}

        {tab === 'cover' && (
          <div className="space-y-3">
            <Input placeholder="论文标题" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea rows={3} placeholder="论文摘要" value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            <Input placeholder="目标期刊名称" value={journal} onChange={(e) => setJournal(e.target.value)} />
            <Button onClick={() => run(() => api.submission.coverLetter(title, abstract, journal))} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 生成 Cover Letter
            </Button>
          </div>
        )}

        {tab === 'reply' && (
          <div className="space-y-3">
            <Textarea rows={6} placeholder="粘贴审稿意见原文（可包含多条）" value={reviewComments} onChange={(e) => setReviewComments(e.target.value)} />
            <Textarea rows={3} placeholder="你的初步回应想法（可选）" value={responseHint} onChange={(e) => setResponseHint(e.target.value)} />
            <Button onClick={() => run(() => api.submission.replyReview(reviewComments, responseHint))} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 生成回复信
            </Button>
          </div>
        )}
      </Card>

      {tab === 'journals' && (
        <>
          {matching && (
            <Card className="p-4 mb-4">
              <Spinner label="AI 结构化匹配期刊中…" />
            </Card>
          )}
          {!matching && match && match.journals.length > 0 && (
            <Card className="p-4 mb-4">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">推荐期刊（按匹配度排序）</div>
              <div className="space-y-3">
                {[...match.journals]
                  .sort((a, b) => b.score - a.score)
                  .map((j) => {
                    const meta = [
                      j.if2024 ? `IF ${j.if2024}` : '',
                      j.quartile || '',
                      j.firstDecisionWeeks ? `${j.firstDecisionWeeks} 周一审` : '',
                      j.acceptanceRate ? `录用率 ${j.acceptanceRate}%` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <div key={j.name} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{j.name}</span>
                          {j.isInLibrary && <Badge tone="green">已在期刊库</Badge>}
                          {j.oa && <Badge tone="slate">{j.oa === 'yes' ? 'OA' : j.oa}</Badge>}
                        </div>
                        <HBar
                          barHeight={7}
                          items={[
                            {
                              label: '匹配度',
                              value: j.score,
                              max: 100,
                              sub: meta,
                              hint: `${j.name}：匹配度 ${j.score}/100${meta ? ` · ${meta}` : ''}`,
                            },
                          ]}
                        />
                        {(j.reason || j.gap) && (
                          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                            {j.reason && (
                              <div>
                                <span className="text-slate-400 dark:text-slate-500">推荐理由：</span>
                                {j.reason}
                              </div>
                            )}
                            {j.gap && (
                              <div>
                                <span className="text-slate-400 dark:text-slate-500">差距提示：</span>
                                {j.gap}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Card>
          )}
          {!matching && match && match.journals.length === 0 && (
            <Card className="p-4 mb-4 text-center text-slate-400 dark:text-slate-500 text-sm">未匹配到合适期刊，补充摘要后重试</Card>
          )}

          {/* 期刊库管理 */}
          <Card className="p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Library size={15} className="text-teal-600" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">我的期刊库</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">已收录 {lib.length} 本</span>
            </div>
            <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-2">
              <Input placeholder="期刊名（必填）" value={libForm.name} onChange={(e) => setLibForm((f) => ({ ...f, name: e.target.value }))} />
              <Input placeholder="ISSN（可选）" value={libForm.issn} onChange={(e) => setLibForm((f) => ({ ...f, issn: e.target.value }))} />
              <Input placeholder="出版商（可选）" value={libForm.publisher} onChange={(e) => setLibForm((f) => ({ ...f, publisher: e.target.value }))} />
              <Input placeholder="分区 如 Q1（可选）" value={libForm.quartile} onChange={(e) => setLibForm((f) => ({ ...f, quartile: e.target.value }))} />
              <Input placeholder="IF 2024（可选）" value={libForm.if2024} onChange={(e) => setLibForm((f) => ({ ...f, if2024: e.target.value }))} />
            </div>
            <Button variant="outline" className="text-xs mb-3" disabled={!libForm.name.trim()} onClick={addLibJournal}>
              <Plus size={13} /> 添加到期刊库
            </Button>
            {lib.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">
                期刊库为空 —— 添加常投期刊后，上方匹配结果会自动标记「已在期刊库」
              </div>
            ) : (
              <div className="space-y-1.5">
                {lib.map((j) => (
                  <div key={j.id} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">{j.name}</span>
                    {j.if2024 ? <Badge tone="teal">IF {j.if2024}</Badge> : null}
                    {j.quartile ? <Badge tone="slate">{j.quartile}</Badge> : null}
                    {j.firstDecisionWeeks ? <span className="text-[11px] text-slate-400 dark:text-slate-500">{j.firstDecisionWeeks} 周一审</span> : null}
                    <button className="text-slate-300 hover:text-rose-500 shrink-0" title="移除" onClick={async () => { await api.submission.removeJournal(j.id); loadLib(); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {tab !== 'journals' && (
      busy ? (
        <Card className="p-4">
          <Spinner label="AI 生成中…" />
        </Card>
      ) : output ? (
        <Card className="p-4">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">生成结果</div>
          <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 max-h-[480px] overflow-y-auto">{output}</div>
        </Card>
      ) : (
        <Card className="p-4 text-center text-slate-400 dark:text-slate-500 text-sm">填写信息后生成结果会显示在这里</Card>
      )
      )}
    </div>
  );
}
