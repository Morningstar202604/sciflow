import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, ChevronRight, ClipboardCheck, FileText, FlaskConical, Gauge,
  History, Languages, ListTree, Loader2, Mail, MessageSquare, Plus, Sparkles, Trash2, ArrowDownToLine, Upload,
} from 'lucide-react';
import { api } from '../api/client';
import { ChatPanel } from './ChatPanel';
import { ToastContext } from '../App';
import type {
  CitationRow, Doc, DocVersionEntry, Experiment, Outline, Project, QualityReport,
  Reference, ResearchDesignResult, ReviewComment, SimulatedReviewResult,
} from '../types';
import type { VersionSnapshot } from './VersionDiffModal';
import {
  Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Modal, Select, Spinner, Textarea, errMsg,
  downloadBase64, downloadText, jsonText,
} from '../components/ui';
import { HBar } from '../components/charts';
import { WritingEditor } from './writing/WritingEditor';
import { WritingPreview } from './writing/WritingPreview';
import { WritingCitations } from './writing/WritingCitations';
import { formatRefEntry } from './writing/citeStyles';

/** 版本快照 diff 拆至独立 chunk（VersionDiffModal，仅打开对比时加载） */
const VersionDiffModal = lazy(() => import('./VersionDiffModal').then((m) => ({ default: m.VersionDiffModal })));
/** 著者-年重排入口（按钮+预览 Modal）拆至独立 chunk */
export const CiteReorderButtonLazy = lazy(() => import('./CiteReorderButton').then((m) => ({ default: m.CiteReorderButton })));
/** 导出区（Markdown/.tex/HTML/Word）独立 lazy chunk */
const DocExporter = lazy(() => import('./DocExporter').then((m) => ({ default: m.DocExporter })));

/** 取编辑器 textarea DOM 节点（ui.tsx 的 Textarea 未透传 ref，用 id 定位，不改 ui.tsx） */
function getEditorTa(): HTMLTextAreaElement | null {
  return typeof document === 'undefined' ? null : (document.getElementById('sciflow-editor') as HTMLTextAreaElement | null);
}

const SEC = 'text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5';

/** 质量分配色：≥good 默认色，good~mid 琥珀，<mid 红 */
const scoreColor = (v: number, good = 70, mid = 50) => (v >= good ? undefined : v >= mid ? '#f59e0b' : '#f87171');

const QUALITY_DIMS = [
  { key: 'literature', label: '文献充分性' },
  { key: 'logic', label: '逻辑一致性' },
  { key: 'citation', label: '引用规范' },
  { key: 'language', label: '语言质量' },
  { key: 'novelty', label: '创新性' },
  { key: 'figures', label: '图表' },
  { key: 'format', label: '格式' },
];

export function WritingPage({ project, initialDocId }: { project: Project; initialDocId: string | null }) {
  /* ============ 文档与内容状态 ============ */
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState<string | null>(initialDocId);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [content, setContent] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [sectionTarget, setSectionTarget] = useState('');

  /* ============ AI 工具状态 ============ */
  const [polishResult, setPolishResult] = useState<{ original: string; polished: string; reason: string } | null>(null);
  const [translateTarget, setTranslateTarget] = useState<'zh' | 'en'>('zh');
  const [abstractResult, setAbstractResult] = useState<{ abstract: string; keywords: string[] } | null>(null);
  const [designResult, setDesignResult] = useState<ResearchDesignResult | null>(null);
  const [designIdea, setDesignIdea] = useState('');
  const [reviewResult, setReviewResult] = useState<SimulatedReviewResult | null>(null);

  /* ============ 审稿意见闭环状态 ============ */
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [savingReply, setSavingReply] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [importingComments, setImportingComments] = useState(false);

  /* ============ 引用管理状态 ============ */
  const [refs, setRefs] = useState<Reference[]>([]);
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [history, setHistory] = useState<{ type: string; original: string; polished: string; reason: string }[]>([]);
  const [exportFormat, setExportFormat] = useState('apa');
  const [exported, setExported] = useState<string[]>([]);
  const [citePickerOpen, setCitePickerOpen] = useState(false);
  const [addingCiteId, setAddingCiteId] = useState<string | null>(null);

  /* ============ 视图状态 ============ */
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'edit' : 'split'));
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'outline' | 'chat' | 'tools' | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('current');

  /* ============ 文档管理状态 ============ */
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<Doc | null>(null);

  /* ============ 质量与关联数据 ============ */
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [docExperiments, setDocExperiments] = useState<Experiment[]>([]);
  const [experimentsOpen, setExperimentsOpen] = useState(false);

  const toast = useContext(ToastContext);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ============ 数据加载 ============ */

  const loadDocs = useCallback(async () => {
    const list = await api.documents.list(project.id);
    setDocs(list);
    setDocId((prev) => (list.some((d) => d.id === prev) ? prev : (list[0]?.id ?? null)));
  }, [project.id]);

  useEffect(() => {
    loadDocs().catch((e: unknown) => setError(errMsg(e)));
    api.references.list(project.id).then(setRefs).catch(() => setRefs([]));
  }, [loadDocs, project.id]);

  useEffect(() => {
    if (!docId) {
      setDoc(null);
      setContent('');
      setOutline(null);
      return;
    }
    api.documents
      .get(docId)
      .then((d) => {
        setDoc(d);
        setContent(d.content ?? '');
        setOutline(jsonText<Outline | null>(d.outline, null));
      })
      .catch((e: unknown) => setError(errMsg(e)));
  }, [docId]);

  useEffect(() => {
    if (docId) {
      api.documents.citations(docId).then(setCitations).catch(() => setCitations([]));
      api.documents.polishRecords(docId).then(setHistory).catch(() => setHistory([]));
      setCommentsLoading(true);
      api.research.reviewComments(docId)
        .then(setReviewComments)
        .catch(() => setReviewComments([]))
        .finally(() => setCommentsLoading(false));
      api.quality.latest(docId).then(setQualityReport).catch(() => setQualityReport(null));
      api.experiments.byDocument(docId).then(setDocExperiments).catch(() => setDocExperiments([]));
    } else {
      setReviewComments([]);
      setQualityReport(null);
      setDocExperiments([]);
    }
  }, [docId]);

  /* ============ 保存（防抖 + ⌘S） ============ */

  const saveNow = useCallback(
    async (manual = false) => {
      if (!docId || content === doc?.content) return;
      const updated = await api.documents.update(docId, { content });
      setDoc(updated);
      setSavedAt(Date.now());
      if (manual) toast('success', '文档已保存');
    },
    [docId, content, doc?.content, toast],
  );

  useEffect(() => {
    if (!docId || content === doc?.content) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNow();
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, docId, doc?.content, saveNow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !docId) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        saveNow(true);
      } else if (k === 'b') {
        e.preventDefault();
        setShowOutlinePanel((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docId, saveNow]);

  /* ============ 工具函数 ============ */

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setAiBusy(true);
    try {
      await fn();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setAiBusy(false);
    }
  };

  const chapterStats = useMemo(() => {
    if (!content) return [] as { label: string; value: number }[];
    return content
      .split(/\n\s*##+\s*/)
      .map((part, i) => {
        const lines = part.split('\n');
        const title = i === 0 ? '前言/摘要' : (lines[0] || '未命名章节').replace(/^#+\s*/, '').trim();
        const body = i === 0 ? part : lines.slice(1).join('\n');
        return { label: title.slice(0, 16), value: body.replace(/\s/g, '').length };
      })
      .filter((c) => c.value > 0);
  }, [content]);

  const qualityScores = useMemo(
    () => (qualityReport ? jsonText<Record<string, number>>(qualityReport.scores, {}) : {}),
    [qualityReport],
  );

  const snapshots = useMemo<VersionSnapshot[]>(() => {
    if (!doc) return [];
    const arr = jsonText<DocVersionEntry[]>(doc.versions || '[]', []);
    const hist = arr.map((s) => ({ ...s, content: s.content ?? '' }));
    return [...hist, { version: doc.version, content, updatedAt: doc.updatedAt, current: true }];
  }, [doc, content]);

  const openDiffModal = () => {
    setDiffModalOpen(true);
    if (!diffA) {
      const histKeys = snapshots.filter((s) => !s.current).map((s) => `v${s.version}`);
      setDiffA(histKeys[histKeys.length - 1] || 'current');
      setDiffB('current');
    }
  };

  const restoreSnapshot = (s: VersionSnapshot) => {
    setContent(s.content);
    toast('success', `已恢复到 v${s.version}（防抖自动保存将写回）`);
    setDiffModalOpen(false);
  };

  /* ============ 文档 CRUD ============ */

  const createDoc = async () => {
    const title = newDocTitle.trim();
    if (!title) return;
    setCreatingDoc(true);
    setError('');
    try {
      const d = await api.documents.create(project.id, title);
      setDocs((s) => [...s, d]);
      setDocId(d.id);
      setNewDocTitle('');
      setShowNewDoc(false);
      toast('success', `文档「${d.title}」已创建`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setCreatingDoc(false);
    }
  };

  const confirmDeleteDoc = async () => {
    if (!deletingDoc) return;
    try {
      await api.documents.remove(deletingDoc.id);
      setDocs((s) => s.filter((d) => d.id !== deletingDoc.id));
      if (docId === deletingDoc.id) setDocId(null);
      toast('info', `文档「${deletingDoc.title}」已删除`);
      setDeletingDoc(null);
    } catch (e: unknown) {
      setError(errMsg(e));
      setDeletingDoc(null);
    }
  };

  /* ============ AI 写作工具 ============ */

  const generateOutline = () =>
    run(async () => {
      const o = await api.documents.outline(docId!, topicInput || doc?.title || '');
      toast('success', '大纲已生成');
      setOutline(o);
      setDoc((d) => (d ? { ...d, outline: JSON.stringify(o) } : d));
      setShowOutlinePanel(true);
    });

  const draftSection = (title: string) =>
    run(async () => {
      const { text } = await api.documents.section(docId!, title);
      setContent((c) => (c ? `${c}\n\n${text}` : text));
    });

  const doPolish = (mode: 'polish' | 'reduce') =>
    run(async () => {
      const target = window.getSelection()?.toString()?.trim() || content;
      if (!target) throw new Error('请先在编辑器中选中文本，或保证文档有内容');
      const r = await api.documents.polish(docId!, target, mode);
      setPolishResult(r);
      setHistory((h) => [{ type: mode, original: r.original, polished: r.polished, reason: r.reason }, ...h]);
    });

  const doTranslate = () =>
    run(async () => {
      const target = window.getSelection()?.toString()?.trim() || content;
      if (!target) throw new Error('请选择要翻译的文本');
      const { translated } = await api.documents.translate(docId!, target, translateTarget);
      setPolishResult({ original: target, polished: translated, reason: `学术翻译（${translateTarget === 'zh' ? '英→中' : '中→英'}）` });
    });

  const applyPolished = () => {
    if (!polishResult) return;
    if (window.getSelection()?.toString()) {
      setContent((c) => c.replace(polishResult.original, polishResult.polished) || polishResult.polished);
    } else {
      setContent(polishResult.polished);
    }
    setPolishResult(null);
  };

  const spliceIntoCursor = useCallback(
    (insert: string): number => {
      const ta = getEditorTa();
      let start = ta?.selectionStart ?? content.length;
      let end = ta?.selectionEnd ?? content.length;
      if (Number.isNaN(start) || start < 0) start = end = content.length;
      const sel = content.slice(start, end);
      const next = content.slice(0, start) + sel + insert + content.slice(end);
      setContent(next);
      const caret = start + sel.length + insert.length;
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = caret;
        }
      });
      return caret;
    },
    [content],
  );

  const insertExperimentIntoBody = (exp: Experiment) => {
    if (!exp.conclusion && !exp.figures?.[0]) {
      toast('info', '该实验暂无结论或结果图可插入');
      return;
    }
    let block = `\n\n**实验结论${exp.goal ? `（${exp.goal}）` : ''}**\n\n`;
    if (exp.conclusion) block += `${exp.conclusion}\n\n`;
    if (exp.figures?.[0]) block += `![实验结果图](${exp.figures[0]})\n\n`;
    spliceIntoCursor(block);
    toast('success', '实验结论已插入正文光标处');
  };

  const generateAbstract = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文，再生成摘要');
      const r = await api.documents.abstract(docId!);
      setAbstractResult(r);
      toast('success', '摘要与关键词已生成');
    });

  const runDesignReview = () =>
    run(async () => {
      if (!designIdea.trim()) throw new Error('请先描述你的研究想法');
      const r = await api.research.designReview(designIdea.trim(), refs.map((x) => ({ title: x.title, year: x.year, venue: x.venue, abstract: x.abstract || '' })));
      setDesignResult(r);
      toast('success', '研究设计诊断完成');
    });

  const runSimulatedReview = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文');
      const r = await api.research.review(doc?.title || '未命名论文', content);
      setReviewResult(r);
      toast('success', '模拟同行评审完成');
    });

  /* ============ 引用管理 ============ */

  const buildExportedList = useCallback(
    (format: string): string[] =>
      citations.map((c, i) =>
        formatRefEntry(
          { title: c.reference.title, authors: c.reference.authors, year: c.reference.year, venue: c.reference.venue, doi: c.reference.doi },
          format,
          i + 1,
        ),
      ),
    [citations],
  );

  useEffect(() => {
    if (exportFormat !== 'bibtex' && citations.length > 0) {
      setExported(buildExportedList(exportFormat));
    }
  }, [citations, exportFormat, buildExportedList]);

  const exportRefs = async (format: string) => {
    setExportFormat(format);
    setError('');
    if (format === 'bibtex') {
      try {
        setExported(await api.documents.exportCitations(docId!, 'bibtex'));
      } catch (e: unknown) {
        setError(errMsg(e));
      }
      return;
    }
    setExported(buildExportedList(format));
  };

  const insertCitationAnchor = async (referenceId: string) => {
    if (!docId) return;
    const ta = getEditorTa();
    const start = ta?.selectionStart ?? content.length;
    const end = ta?.selectionEnd ?? content.length;
    const existing = citations.findIndex((c) => c.referenceId === referenceId);
    const n = existing >= 0 ? existing + 1 : citations.length + 1;
    const marker = `[${n}]`;
    const sel = content.slice(start, end);
    const next = content.slice(0, start) + sel + marker + content.slice(end);
    const caret = start + sel.length + marker.length;
    setContent(next);
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = caret;
      }
    });
    if (existing < 0) {
      setAddingCiteId(referenceId);
      try {
        const mIdx = next.indexOf(marker, start);
        const ctx =
          next.slice(Math.max(0, mIdx - 60), mIdx) + `⟦${marker}⟧` + next.slice(mIdx + marker.length, mIdx + marker.length + 60);
        await api.references.addCitation({ documentId: docId, referenceId, location: `anchor:${n}`, context: ctx });
        setCitations(await api.documents.citations(docId));
        toast('success', `已加入引用并插入正文锚点 [${n}]`);
      } catch (e: unknown) {
        setError(errMsg(e));
      } finally {
        setAddingCiteId(null);
      }
    } else {
      toast('success', `已在光标处追加引用锚点 [${n}]`);
    }
  };

  /* ============ 导出 ============ */

  const exportWord = async () => {
    if (!doc) return;
    try {
      setAiBusy(true);
      const { base64, filename } = await api.documents.exportDocx(doc.id);
      downloadBase64(filename, base64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      toast('success', 'Word 文档已导出（含标题/大纲/正文/参考文献）');
    } catch {
      toast('error', 'Word 导出失败');
    } finally {
      setAiBusy(false);
    }
  };

  const exportFullDoc = () =>
    run(async () => {
      const { markdown, filename } = await api.documents.exportMarkdown(docId!);
      downloadText(filename, markdown, 'text/markdown;charset=utf-8');
      setError('');
    });

  /* ============ 审稿意见闭环 ============ */

  const COMMENT_STATUS_META: Record<string, { label: string; tone: 'amber' | 'green' | 'slate' }> = {
    open: { label: '待处理', tone: 'amber' },
    resolved: { label: '已解决', tone: 'green' },
    deferred: { label: '暂缓', tone: 'slate' },
  };

  const changeCommentStatus = async (c: ReviewComment, status: 'open' | 'resolved' | 'deferred') => {
    const prev = c.status;
    setReviewComments((s) => s.map((x) => (x.id === c.id ? { ...x, status } : x)));
    try {
      const updated = await api.research.updateReviewComment(c.id, { status });
      setReviewComments((s) => s.map((x) => (x.id === c.id ? updated : x)));
    } catch (e: unknown) {
      setReviewComments((s) => s.map((x) => (x.id === c.id ? { ...x, status: prev } : x)));
      setError(errMsg(e));
    }
  };

  const saveReply = async (c: ReviewComment) => {
    setSavingReply(true);
    try {
      const updated = await api.research.updateReviewComment(c.id, { responseText: replyDraft });
      setReviewComments((s) => s.map((x) => (x.id === c.id ? updated : x)));
      setReplyId(null);
      setReplyDraft('');
      toast('success', '回复已保存');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setSavingReply(false);
    }
  };

  const removeComment = async (c: ReviewComment) => {
    setReviewComments((s) => s.filter((x) => x.id !== c.id));
    try {
      await api.research.removeReviewComment(c.id);
      toast('info', '已删除该条意见');
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const generateResponseLetter = async () => {
    setGeneratingLetter(true);
    setError('');
    try {
      const r = await api.research.responseLetter(docId!);
      setLetter(r.letter);
      toast('success', 'Point-by-point 回复信已生成');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setGeneratingLetter(false);
    }
  };

  const importFromSimulatedReview = async () => {
    if (!reviewResult || 'error' in reviewResult) return;
    setImportingComments(true);
    setError('');
    try {
      const existing = new Set(reviewComments.map((c) => c.commentText.trim()));
      const toAdd: { reviewer: string; commentText: string; category: string }[] = [];
      for (const rv of reviewResult.reviewers) {
        for (const c of rv.concerns) {
          const t = c.trim();
          if (t && !existing.has(t)) {
            toAdd.push({ reviewer: rv.role, commentText: t, category: 'concern' });
            existing.add(t);
          }
        }
      }
      if (!toAdd.length) {
        toast('info', '没有新的 concerns 可导入（已去重）');
        return;
      }
      const added = await api.research.addReviewComments(docId!, toAdd);
      setReviewComments((s) => [...s, ...added]);
      setCommentsOpen(true);
      toast('success', `已从模拟评审导入 ${added.length} 条审稿意见`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setImportingComments(false);
    }
  };

  /* ============ UI 组装 ============ */

  const newDocDialog = (
    <Modal open={showNewDoc} title="新建论文文档" onClose={() => setShowNewDoc(false)} width="max-w-md">
      <Input
        placeholder="文档标题，如：图神经网络在药物发现中的研究综述"
        value={newDocTitle}
        onChange={(e) => setNewDocTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && createDoc()}
        autoFocus
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setShowNewDoc(false)}>
          取消
        </Button>
        <Button onClick={createDoc} disabled={creatingDoc || !newDocTitle.trim()}>
          {creatingDoc ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 创建
        </Button>
      </div>
    </Modal>
  );

  // 子组件插槽：预览区
  const previewSlot = (
    <WritingPreview
      content={content}
      editorMode={editorMode}
      exported={exported}
    />
  );

  // 子组件插槽：引用管理
  const citationsSlot = (
    <WritingCitations
      refs={refs}
      citations={citations}
      exportFormat={exportFormat}
      exported={exported}
      citePickerOpen={citePickerOpen}
      addingCiteId={addingCiteId}
      history={history}
      onOpenPicker={() => setCitePickerOpen(true)}
      onClosePicker={() => setCitePickerOpen(false)}
      onInsertAnchor={insertCitationAnchor}
      onChangeFormat={(f) => setExportFormat(f)}
      onExport={exportRefs}
      docId={docId}
      onApplyReorder={setContent}
      aiBusy={aiBusy}
      renderDocExporter={
        <Suspense fallback={<div className="h-7" />}>
          <DocExporter
            doc={doc}
            content={content}
            citations={citations}
            project={project}
            onExportFull={exportFullDoc}
            onExportWord={exportWord}
            aiBusy={aiBusy}
          />
        </Suspense>
      }
    />
  );

  /* ============ 渲染 ============ */

  if (!doc) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-6">
          <Empty text="这里空空如也——新建一篇论文，或到「全自动流水线」一键生成初稿" hint="大纲生成 / 章节起草 / 润色 / 翻译 / 降重，全流程 AI 辅助" />
          <div className="flex justify-center">
            <Button onClick={() => setShowNewDoc(true)}>
              <Plus size={15} /> 新建文档
            </Button>
          </div>
        </Card>
        {newDocDialog}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 文档标签栏 */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto shrink-0 pb-1">
        {docs.map((d) => (
          <div
            key={d.id}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap cursor-pointer border ${
              docId === d.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-teal-300'
            }`}
            onClick={() => setDocId(d.id)}
          >
            <FileText size={13} />
            {d.title}
            <button
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setDeletingDoc(d);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <Button variant="outline" onClick={() => setShowNewDoc(true)} className="px-2.5 py-1">
          <Plus size={14} />
        </Button>
      </div>

      <ErrorBox message={error} />

      {/* 移动端工具面板切换（md+ 隐藏；三面板互斥，收起后编辑器全宽） */}
      <div className="flex items-center gap-1.5 mb-3 md:hidden shrink-0 overflow-x-auto pb-0.5 -mt-0.5">
        {([['outline', '大纲', ListTree], ['chat', 'AI 助手', Bot], ['tools', 'AI 工具', Sparkles]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setMobilePanel((m) => (m === key ? null : key))}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap transition-all duration-150 ${
              mobilePanel === key ? 'brand-btn text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-teal-300'
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
        {mobilePanel && (
          <button className="ml-auto text-[11px] text-slate-400 dark:text-slate-500 underline shrink-0" onClick={() => setMobilePanel(null)}>
            收起面板
          </button>
        )}
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* 大纲栏（桌面常驻可折叠；移动端经切换条独占全宽） */}
        <Card className={`w-full md:w-60 shrink-0 p-3 overflow-y-auto flex flex-col ${showOutlinePanel || mobilePanel === 'outline' ? '' : 'hidden md:flex'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <ListTree size={14} /> 大纲
            </span>
            <div className="flex items-center gap-1">
              {mobilePanel === 'outline' && (
                <Button variant="ghost" className="px-2 py-0.5 text-xs md:hidden" onClick={() => setMobilePanel(null)}>
                  收起
                </Button>
              )}
              <Button variant="ghost" className="hidden md:inline-flex px-2 py-0.5 text-xs" onClick={() => setShowOutlinePanel((v) => !v)}>
                {showOutlinePanel ? '隐藏' : '显示'}
              </Button>
            </div>
          </div>
          {!outline ? (
            <div className="text-xs text-slate-400 dark:text-slate-500">暂无大纲。输入主题生成：</div>
          ) : (
            <div className="space-y-1.5">
              <div className="font-medium text-slate-800 dark:text-slate-100 text-sm mb-1">{outline.title}</div>
              {outline.sections?.map((s, i) => (
                <div key={i} className="group">
                  <button
                    className="flex items-center gap-1 w-full text-left text-sm text-slate-600 dark:text-slate-300 hover:text-teal-700 py-1 rounded"
                    onClick={() => draftSection(s.title)}
                    title="点击起草此章节"
                  >
                    <ChevronRight size={13} className="shrink-0" />
                    <span className="truncate">{s.title}</span>
                    <Sparkles size={12} className="opacity-0 group-hover:opacity-100 ml-auto text-teal-500 shrink-0" />
                  </button>
                  {s.subsections?.length > 0 && (
                    <div className="ml-4 space-y-0.5 text-xs text-slate-400 dark:text-slate-500">
                      {s.subsections.map((sub, j) => (
                        <div key={j}>· {sub}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 章节字数分布（折叠，默认收起，避免挤压大纲树） */}
          {chapterStats.length > 1 && (
            <details className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <summary className="cursor-pointer text-[11px] text-slate-400 dark:text-slate-500 select-none">章节字数分布</summary>
              <div className="mt-2">
                <HBar items={chapterStats} barHeight={5} />
              </div>
            </details>
          )}
          <div className="mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
            <Input placeholder="研究方向 / 论文主题" value={topicInput} onChange={(e) => setTopicInput(e.target.value)} />
            <Button className="w-full mt-2" onClick={generateOutline} disabled={aiBusy || !docId}>
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI 生成大纲
            </Button>
          </div>
        </Card>

        {/* 内联 AI 写作助手（桌面常驻可折叠；移动端经切换条独占全宽） */}
        <div className={`${mobilePanel === 'chat' ? 'flex w-full' : 'hidden'} md:flex md:w-auto shrink-0 min-w-0`}>
          <ChatPanel
            project={project}
            doc={doc}
            onDocUpdated={async (patch) => {
              if (!doc) return;
              try {
                await api.documents.update(doc.id, patch);
                setDoc((prev) => (prev ? { ...prev, ...patch } : prev));
              } catch {
                toast('error', '保存到文档失败');
              }
            }}
          />
        </div>

        {/* 编辑器（移动端打开任一工具面板时让位隐藏） */}
        <WritingEditor
          doc={doc}
          content={content}
          editorMode={editorMode}
          savedAt={savedAt}
          onChangeContent={setContent}
          onTitleBlur={async (newTitle) => {
            if (!docId) return;
            const updated = await api.documents.update(docId, { title: newTitle });
            setDoc(updated);
            setDocs((s) => s.map((d) => (d.id === updated.id ? updated : d)));
          }}
          onModeChange={setEditorMode}
          renderPreview={previewSlot}
        />

        {/* AI 工具面板（桌面 lg+ 常驻；移动端经切换条独占全宽） */}
        <Card className={`${mobilePanel === 'tools' ? 'flex flex-col w-full' : 'hidden'} lg:flex lg:w-72 shrink-0 p-3 overflow-y-auto`}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Sparkles size={14} className="brand-gradient-text" /> AI 工具
            </div>
            {mobilePanel === 'tools' && (
              <Button variant="ghost" className="px-2 py-0.5 text-xs md:hidden" onClick={() => setMobilePanel(null)}>
                收起
              </Button>
            )}
          </div>

          {aiBusy && <Spinner label="AI 正在处理…" />}

          {/* 科研加强：摘要 + 关键词 */}
          <div className="mb-4">
            <div className={SEC}>论文摘要 + 关键词（AI 一键生成）</div>
            <Button variant="outline" className="text-xs w-full" onClick={generateAbstract} disabled={aiBusy || !content.trim()}>
              <Sparkles size={12} className="text-teal-600" /> 生成摘要与关键词
            </Button>
            {abstractResult && (
              <div className="mt-2 text-xs bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded p-2 text-slate-700 dark:text-slate-300">
                <div className="font-medium text-teal-700 dark:text-teal-300 mb-1">摘要</div>
                <div className="mb-2 leading-relaxed">{abstractResult.abstract}</div>
                <div className="font-medium text-teal-700 dark:text-teal-300 mb-1">关键词</div>
                <div className="flex flex-wrap gap-1">
                  {abstractResult.keywords.map((k, i) => (
                    <span key={i} className="bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 rounded px-1.5 py-0.5">{k}</span>
                  ))}
                </div>
                <button
                  className="mt-2 text-teal-600 dark:text-teal-400 underline"
                  onClick={() => {
                    const tail = `\n\n**摘要**：${abstractResult.abstract}\n\n**关键词**：${abstractResult.keywords.join('、')}`;
                    setContent((c) => (c.endsWith('\n\n') ? c + tail.trimStart() : c + tail));
                    setAbstractResult(null);
                  }}
                >
                  插入到正文顶部
                </button>
              </div>
            )}
          </div>

          {/* 科研加强：研究设计诊断 */}
          <div className="mb-4">
            <div className={SEC}>研究设计诊断（选题阶段：新颖性 / 可行性 / 风险）</div>
            <Textarea
              rows={2}
              placeholder="描述你的研究想法，如：用图神经网络预测蛋白质-药物相互作用…"
              value={designIdea}
              onChange={(e) => setDesignIdea(e.target.value)}
              className="mb-2"
            />
            <Button variant="outline" className="text-xs w-full" onClick={runDesignReview} disabled={aiBusy || !designIdea.trim()}>
              <FlaskConical size={12} className="text-teal-600" /> 诊断研究想法
            </Button>
            {designResult && !('error' in designResult) && (
              <div className="mt-2 text-xs space-y-2">
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <HBar
                    max={100}
                    barHeight={6}
                    items={[
                      { label: '新颖性', value: designResult.noveltyScore, sub: designResult.noveltyFeedback.slice(0, 14) + '…', color: scoreColor(designResult.noveltyScore), hint: designResult.noveltyFeedback },
                      { label: '可行性', value: designResult.feasibilityScore, sub: designResult.feasibilityFeedback.slice(0, 14) + '…', color: scoreColor(designResult.feasibilityScore), hint: designResult.feasibilityFeedback },
                    ]}
                  />
                  <div className="mt-2 space-y-1 text-slate-600 dark:text-slate-300 leading-relaxed">
                    <div><span className="text-teal-700 dark:text-teal-300 font-medium">新颖性：</span>{designResult.noveltyFeedback}</div>
                    <div><span className="text-sky-700 dark:text-sky-300 font-medium">可行性：</span>{designResult.feasibilityFeedback}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <div className="text-slate-500 dark:text-slate-400 mb-0.5">建议方法</div>
                  <div className="flex flex-wrap gap-1">{designResult.methods.map((m, i) => <span key={i} className="bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-slate-600 dark:text-slate-300">{m}</span>)}</div>
                </div>
                <div className="rounded-lg border border-amber-100 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-900/10 p-2">
                  <div className="text-amber-600 dark:text-amber-400 mb-0.5">风险</div>
                  <ul className="list-disc pl-4 text-slate-600 dark:text-slate-300">{designResult.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <div className="text-teal-600 dark:text-teal-400 mb-0.5">下一步</div>
                  <ol className="list-decimal pl-4 text-slate-600 dark:text-slate-300">{designResult.nextSteps.map((n, i) => <li key={i}>{n}</li>)}</ol>
                </div>
              </div>
            )}
          </div>

          {/* 章节起草 */}
          <div className="mb-4">
            <div className={SEC}>章节起草（点击大纲章节或选择）</div>
            <Select
              options={[
                { value: '', label: '选择要起草的章节…' },
                ...(outline?.sections || []).map((s) => ({ value: s.title, label: s.title })),
              ]}
              value={sectionTarget}
              onChange={(v) => {
                setSectionTarget(v);
                if (v) draftSection(v);
              }}
            />
          </div>

          {/* 润色 / 降重 / 翻译 */}
          <div className="mb-4 space-y-2">
            <div className={SEC}>润色 / 降重 / 翻译（默认处理全文，也可先选中文本）</div>
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={() => doPolish('polish')} disabled={aiBusy}>
                学术润色
              </Button>
              <Button className="flex-1" variant="outline" onClick={() => doPolish('reduce')} disabled={aiBusy}>
                降重改写
              </Button>
            </div>
            <div className="flex gap-2">
              <Select
                className="flex-1"
                options={[
                  { value: 'zh', label: '英 → 中' },
                  { value: 'en', label: '中 → 英' },
                ]}
                value={translateTarget}
                onChange={(v) => setTranslateTarget(v as 'zh' | 'en')}
              />
              <Button className="flex-1" variant="outline" onClick={doTranslate} disabled={aiBusy}>
                <Languages size={14} /> 翻译
              </Button>
            </div>
          </div>

          {/* 科研加强：模拟同行评审 */}
          <div className="mb-4">
            <div className={SEC}>模拟同行评审（投稿前：3 审稿人 + 主编决定）</div>
            <Button variant="outline" className="text-xs w-full" onClick={runSimulatedReview} disabled={aiBusy || !content.trim()}>
              <ClipboardCheck size={12} className="text-teal-600" /> 模拟评审全文
            </Button>
            {reviewResult && !('error' in reviewResult) && (
              <div className="mt-2 text-xs space-y-2">
                <div className="rounded-lg bg-teal-50/60 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-2">
                  <div className="text-teal-700 dark:text-teal-300 font-medium mb-0.5">主编决定：{reviewResult.verdict}</div>
                  <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{reviewResult.overall}</div>
                </div>
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">审稿人得分（满分 100）</div>
                  <HBar
                    max={100}
                    barHeight={6}
                    items={reviewResult.reviewers.map((rv) => ({
                      label: rv.role,
                      value: rv.score,
                      color: scoreColor(rv.score, 80, 60),
                      hint: rv.concerns.join('；').slice(0, 60),
                    }))}
                  />
                </div>
                {reviewResult.reviewers.map((rv, i) => (
                  <div key={i} className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                    <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">{rv.role} · {rv.score} 分</div>
                    <div className="text-slate-600 dark:text-slate-300 mb-1">👍 {rv.strengths.join('；')}</div>
                    <div className="text-slate-500 dark:text-slate-400 mb-1">⚠ {rv.concerns.join('；')}</div>
                    <div className="text-teal-600 dark:text-teal-400">建议：{rv.suggestion}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 审稿意见闭环 */}
          <div className="mb-4">
            <button
              className={`w-full flex items-center justify-between ${SEC}`}
              onClick={() => setCommentsOpen((v) => !v)}
            >
              <span className="flex items-center gap-1"><MessageSquare size={12} className="text-teal-600" /> 审稿意见闭环</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {reviewComments.length > 0 && `${reviewComments.length} 条 · `}{commentsOpen ? '收起 ▾' : '展开 ▸'}
              </span>
            </button>
            {commentsOpen && (
              <div className="text-xs space-y-2">
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    className="text-xs flex-1"
                    onClick={generateResponseLetter}
                    disabled={aiBusy || generatingLetter || !docId || reviewComments.length === 0}
                  >
                    {generatingLetter ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} 生成回复信
                  </Button>
                  <Button
                    variant="outline"
                    className="text-xs flex-1"
                    onClick={importFromSimulatedReview}
                    disabled={aiBusy || importingComments || !reviewResult || 'error' in reviewResult}
                  >
                    {importingComments ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 导入模拟评审
                  </Button>
                </div>
                {commentsLoading ? (
                  <Spinner />
                ) : reviewComments.length === 0 ? (
                  <div className="text-slate-400 dark:text-slate-500">暂无审稿意见。点「导入模拟评审」把本次评审 concerns 批量入库。</div>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                    {reviewComments.map((c) => {
                      const meta = COMMENT_STATUS_META[c.status] || { label: c.status, tone: 'slate' as const };
                      return (
                        <div key={c.id} className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-medium text-slate-700 dark:text-slate-200">{c.reviewer}</span>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {c.category && <span className="text-[10px] text-slate-400">#{c.category}</span>}
                            <button
                              className="ml-auto text-slate-300 hover:text-rose-500"
                              title="删除该意见"
                              onClick={() => removeComment(c)}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                          <div className="text-slate-600 dark:text-slate-300 mb-1.5 leading-relaxed">{c.commentText}</div>
                          <div className="flex gap-1 mb-1.5">
                            {(['open', 'resolved', 'deferred'] as const).map((st) => (
                              <button
                                key={st}
                                onClick={() => changeCommentStatus(c, st)}
                                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                                  c.status === st
                                    ? st === 'resolved'
                                      ? 'bg-emerald-600 text-white'
                                      : st === 'open'
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-slate-500 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200'
                                }`}
                              >
                                {COMMENT_STATUS_META[st].label}
                              </button>
                            ))}
                          </div>
                          {replyId === c.id ? (
                            <div>
                              <Textarea rows={2} placeholder="撰写针对该意见的 point 回复…" value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} className="mb-1" />
                              <div className="flex gap-1">
                                <Button variant="success" className="text-xs px-2 py-0.5" onClick={() => saveReply(c)} disabled={savingReply}>
                                  {savingReply ? <Loader2 size={11} className="animate-spin" /> : '保存回复'}
                                </Button>
                                <Button variant="ghost" className="text-xs px-2 py-0.5" onClick={() => { setReplyId(null); setReplyDraft(''); }}>取消</Button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              {c.responseText && (
                                <div className="text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 rounded p-1.5 mb-1 leading-relaxed">{c.responseText}</div>
                              )}
                              <button
                                className="text-teal-600 dark:text-teal-400 underline"
                                onClick={() => { setReplyId(c.id); setReplyDraft(c.responseText || ''); }}
                              >
                                {c.responseText ? '编辑回复' : '回复'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {letter && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-teal-700 dark:text-teal-300">Point-by-point 回复信</span>
                      <Button
                        variant="outline"
                        className="text-xs px-2 py-0.5"
                        onClick={() => {
                          navigator.clipboard.writeText(letter)
                            .then(() => toast('success', '回复信已复制到剪贴板'))
                            .catch(() => setError('复制失败'));
                        }}
                      >
                        <ClipboardCheck size={11} /> 复制
                      </Button>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-600 dark:text-slate-300 max-h-56 overflow-y-auto whitespace-pre-wrap">{letter}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 质量评分 */}
          <div className="mb-4">
            <button
              className={`w-full flex items-center justify-between ${SEC}`}
              onClick={() => setQualityOpen((v) => !v)}
            >
              <span className="flex items-center gap-1"><Gauge size={12} className="text-teal-600" /> 质量评分</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {qualityReport ? `总分 ${qualityReport.totalScore} · ` : ''}{qualityOpen ? '收起 ▾' : '展开 ▸'}
              </span>
            </button>
            {qualityOpen && (
              <div className="text-xs">
                {!qualityReport ? (
                  <div className="text-slate-400 dark:text-slate-500">暂无质量评分，可到「质量评分」页对本文档运行 7 维评分。</div>
                ) : (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          最新总分 · {new Date(qualityReport.createdAt).toLocaleDateString()}
                        </span>
                        <span className={`text-base font-semibold leading-none ${qualityReport.totalScore >= 80 ? 'text-emerald-600 dark:text-emerald-400' : qualityReport.totalScore >= 60 ? 'text-amber-500 dark:text-amber-400' : 'text-rose-500 dark:text-rose-400'}`}>
                          {qualityReport.totalScore}
                        </span>
                      </div>
                      <HBar
                        max={100}
                        barHeight={5}
                        showValue={false}
                        items={QUALITY_DIMS.map((d) => {
                          const v = Math.round(qualityScores[d.key] ?? 0);
                          return { label: d.label, value: v, color: scoreColor(v, 75, 60) };
                        })}
                      />
                    </div>
                    {qualityReport.totalScore < 60 && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-2 text-amber-600 dark:text-amber-400">
                        总分偏低，建议返回润色后再投稿。
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 关联实验 */}
          <div className="mb-4">
            <button
              className={`w-full flex items-center justify-between ${SEC}`}
              onClick={() => setExperimentsOpen((v) => !v)}
            >
              <span className="flex items-center gap-1"><FlaskConical size={12} className="text-teal-600" /> 关联实验</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {docExperiments.length > 0 && `${docExperiments.length} 条 · `}{experimentsOpen ? '收起 ▾' : '展开 ▸'}
              </span>
            </button>
            {experimentsOpen && (
              <div className="text-xs">
                {docExperiments.length === 0 ? (
                  <div className="text-slate-400 dark:text-slate-500">暂无关联实验，可到「实验记录」页关联本文档。</div>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                    {docExperiments.map((exp) => (
                      <div key={exp.id} className="rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex-1">{exp.goal || '未命名实验'}</span>
                          <Badge tone={exp.status === 'ok' ? 'green' : exp.status === 'error' ? 'red' : 'amber'}>
                            {exp.status === 'ok' ? '成功' : exp.status === 'error' ? '失败' : '超时'}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">
                          {(exp.runtimeMs / 1000).toFixed(1)}s · {new Date(exp.createdAt).toLocaleDateString()}
                        </div>
                        {exp.figures?.[0] && (
                          <img src={exp.figures[0]} alt="实验结果图" className="w-24 h-auto rounded border border-slate-100 dark:border-slate-800 mb-1" />
                        )}
                        {exp.conclusion && (
                          <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{exp.conclusion}</div>
                        )}
                        {(exp.conclusion || exp.figures?.[0]) && (
                          <button
                            className="mt-1.5 inline-flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:underline text-[11px]"
                            onClick={() => insertExperimentIntoBody(exp)}
                            title="把结论与首图插入正文当前光标处"
                          >
                            <ArrowDownToLine size={11} /> 插入到正文光标处
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 版本历史 */}
          <div className="mb-4">
            <button
              className={`w-full flex items-center justify-between ${SEC}`}
              onClick={() => setVersionsOpen((v) => !v)}
            >
              <span className="flex items-center gap-1"><History size={12} className="text-teal-600" /> 版本历史</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {snapshots.length > 1 ? `${snapshots.length} 个快照 · ` : ''}{versionsOpen ? '收起 ▾' : '展开 ▸'}
              </span>
            </button>
            {versionsOpen && (
              <div className="text-xs space-y-1.5">
                <Button variant="outline" className="text-xs w-full" onClick={openDiffModal} disabled={snapshots.length < 2}>
                  <History size={12} /> 左右栏对比版本
                </Button>
                {snapshots.length < 2 && (
                  <div className="text-slate-400 dark:text-slate-500">再保存一次内容变更才会产生可对比的历史快照。</div>
                )}
              </div>
            )}
          </div>

          {/* 润色结果对比 */}
          {polishResult && (
            <Card className="p-3 mb-4 bg-slate-50 dark:bg-slate-900/50 border-teal-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-teal-700">三段式结果</span>
                <Button variant="success" className="px-2 py-0.5 text-xs" onClick={applyPolished}>
                  应用到正文
                </Button>
              </div>
              <div className="text-xs space-y-2">
                <div>
                  <div className="text-slate-400 dark:text-slate-500 mb-0.5">原文</div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-600 dark:text-slate-300 max-h-28 overflow-y-auto">{polishResult.original}</div>
                </div>
                <div>
                  <div className="text-slate-400 dark:text-slate-500 mb-0.5">润色后</div>
                  <div className="bg-white dark:bg-slate-900 border border-emerald-200 rounded p-2 text-slate-800 dark:text-slate-100 max-h-28 overflow-y-auto">{polishResult.polished}</div>
                </div>
                <div>
                  <div className="text-slate-400 dark:text-slate-500 mb-0.5">理由</div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-500 dark:text-slate-400">{polishResult.reason}</div>
                </div>
              </div>
            </Card>
          )}

          {/* 引用管理（从 WritingCitations 子组件渲染） */}
          {citationsSlot}
        </Card>
      </div>

      {/* 新建文档弹窗（空态与主界面共用） */}
      {newDocDialog}

      {/* 版本左右栏 Diff（独立 lazy chunk，打开时才加载）：两栏对比 + 命名 + 恢复 */}
      <Suspense fallback={null}>
        {diffModalOpen && docId && (
          <VersionDiffModal
            open={diffModalOpen}
            onClose={() => setDiffModalOpen(false)}
            docId={docId}
            snapshots={snapshots}
            diffA={diffA}
            diffB={diffB}
            onSelectA={setDiffA}
            onSelectB={setDiffB}
            onRestore={restoreSnapshot}
          />
        )}
      </Suspense>

      {/* 删除文档确认弹窗 */}
      <ConfirmDialog
        open={!!deletingDoc}
        title="删除文档"
        description={`确定要删除「${deletingDoc?.title ?? ''}」吗？文档内容及其润色/翻译历史将一并删除，且无法恢复。`}
        confirmText="删除"
        danger
        onConfirm={confirmDeleteDoc}
        onClose={() => setDeletingDoc(null)}
      />
    </div>
  );
}
