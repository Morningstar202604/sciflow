import { useEffect, useRef, useState } from 'react';
import { BookMarked, FileText, Loader2, MessageSquare, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { KnowledgeDoc, Project } from '../types';
import { Button, Card, Empty, ErrorBox, Input, SectionTitle, Textarea, Badge, Spinner } from '../components/ui';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function KnowledgePage({ project }: { project: Project }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; sources: { docName: string; snippet: string; score: number }[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const toast = useContext(ToastContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const load = async () => {
    try {
      setDocs(await api.knowledge.list(project.id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [project.id]);

  const uploadFile = async (file: File) => {
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const type = isPdf ? 'pdf' : file.name.toLowerCase().endsWith('.md') ? 'markdown' : 'text';
    setBusy(`upload:${file.name}`);
    setError('');
    try {
      const content = isPdf ? await fileToBase64(file) : await file.text();
      await api.knowledge.upload(project.id, file.name, type, content);
      toast('success', `「${file.name}」已入库`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy('query');
    setError('');
    try {
      setAnswer(await api.knowledge.query(project.id, q));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('删除该资料及其分块？')) return;
    await api.knowledge.remove(id);
    setAnswer(null);
    load();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <ErrorBox message={error} />

      {/* 上传区 */}
      <Card className="p-5 mb-4">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Upload size={16} className="text-teal-600" /> 上传研究资料
          </span>
        </SectionTitle>
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            dragging ? 'border-teal-500 bg-teal-50' : 'border-slate-300 dark:border-slate-700 hover:border-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) uploadFile(file);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = '';
            }}
          />
          <FileText size={28} className="mx-auto text-slate-400 dark:text-slate-500 mb-2" />
          <div className="text-sm text-slate-600 dark:text-slate-300">点击选择或拖拽 PDF / TXT / Markdown 到此处</div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">支持 PDF 解析与自动分块（NotebookLM 式 RAG）</div>
          {busy.startsWith('upload:') && (
            <div className="mt-2">
              <Spinner label={`解析 ${busy.slice(7)}…`} />
            </div>
          )}
        </div>

        {/* 资料列表 */}
        <div className="mt-4">
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">知识库（{docs.length} 份资料）</div>
          {docs.length === 0 ? (
            <Empty text="暂无资料，上传后即可基于资料问答" />
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5">
                  <BookMarked size={15} className="text-teal-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 dark:text-slate-200 truncate">{d.name}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      <Badge tone={d.type === 'pdf' ? 'red' : d.type === 'markdown' ? 'blue' : 'slate'}>{d.type}</Badge>
                      <span className="ml-2">{d.chunkCount} 个分块</span>
                    </div>
                  </div>
                  <button onClick={() => remove(d.id)} className="text-slate-400 dark:text-slate-500 hover:text-rose-500" title="删除">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* RAG 问答 */}
      <Card className="p-5">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <MessageSquare size={16} className="brand-gradient-text" /> 基于资料问答
          </span>
        </SectionTitle>
        <div className="flex gap-2">
          <Input placeholder="例如：Transformer 的核心机制是什么？" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <Button onClick={ask} disabled={busy === 'query' || !question.trim()}>
            {busy === 'query' ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />} 提问
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">答案严格来自你的资料（NotebookLM 式），不依赖外部知识</div>

        {busy === 'query' && (
          <div className="mt-4">
            <Spinner label="检索资料并综合回答…" />
          </div>
        )}
        {answer && (
          <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">{answer.answer}</div>
            {answer.sources.length > 0 && (
              <div className="mt-3 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">回答依据来源</div>
                {answer.sources.map((s, i) => (
                  <div key={i} className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                    <Badge tone="teal">{s.docName}</Badge> <span className="text-slate-400 dark:text-slate-500">匹配 {s.score}%</span>
                    <div className="text-slate-400 dark:text-slate-500 mt-0.5 truncate">{s.snippet}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
