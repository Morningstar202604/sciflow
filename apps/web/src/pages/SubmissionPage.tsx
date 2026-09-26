import { useState } from 'react';
import { FilePen, Globe2, Loader2, MessageSquareReply, Send } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project } from '../types';
import { Button, Card, ErrorBox, Input, Select, Spinner, Textarea } from '../components/ui';

type Tab = 'journals' | 'cover' | 'reply';

export function SubmissionPage({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>('journals');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');

  // 期刊推荐
  const [field, setField] = useState('');
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  // Cover Letter
  const [journal, setJournal] = useState('');
  // 审稿回复
  const [reviewComments, setReviewComments] = useState('');
  const [responseHint, setResponseHint] = useState('');

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

  const pickDoc = (id: string) => {
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
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setOutput('');
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px ${
              tab === t.key ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
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
              <div className="text-xs text-slate-400 mb-1">选择项目内论文（自动带入标题与摘要）</div>
              <Select
                className="w-full"
                options={[{ value: '', label: '从项目中选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
                value=""
                onChange={pickDoc}
              />
            </div>
            <Input placeholder="论文标题" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea rows={4} placeholder="论文摘要（可选，从文档自动带入或粘贴）" value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            <Input placeholder="研究领域，如：计算机视觉 / 生物信息学" value={field} onChange={(e) => setField(e.target.value)} />
            <Button onClick={() => run(() => api.submission.journals(title, abstract, field))} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 推荐期刊
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

      {busy ? (
        <Card className="p-4">
          <Spinner label="AI 生成中…" />
        </Card>
      ) : output ? (
        <Card className="p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">生成结果</div>
          <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-lg p-3 max-h-[480px] overflow-y-auto">{output}</div>
        </Card>
      ) : (
        <Card className="p-4 text-center text-slate-400 text-sm">填写信息后生成结果会显示在这里</Card>
      )}
    </div>
  );
}
