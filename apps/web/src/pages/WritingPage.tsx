import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { BookOpen, Bot, Check, ChevronRight, ClipboardCheck, Crosshair, Eye, FileText, FlaskConical, Gauge, History, Languages, ListTree, Loader2, Mail, MessageSquare, Pencil, Plus, Sparkles, Trash2, ArrowDownToLine, Upload } from 'lucide-react';
import { api } from '../api/client';
import { ChatPanel } from './ChatPanel';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { CitationRow, Doc, DocVersionEntry, Experiment, Outline, Project, QualityReport, Reference, ResearchDesignResult, ReviewComment, SimulatedReviewResult } from '../types';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Modal, Select, Spinner, Textarea, downloadBase64, downloadText, jsonText } from '../components/ui';
import { Donut, HBar } from '../components/charts';

/* =====================================================================
 * 前端自实现参考文献样式（零依赖；与后端 formatCitation 同构，扩展到 8 种）
 * authors 为 JSON 字符串数组；加粗/斜体以纯文本近似
 * ===================================================================== */
type CiteStyleMeta = { value: string; label: string; inText: string; numbered: boolean };
const CITE_STYLES: CiteStyleMeta[] = [
  { value: 'apa', label: 'APA 7', inText: '(Author, Year)', numbered: false },
  { value: 'ieee', label: 'IEEE', inText: '[n]', numbered: true },
  { value: 'vancouver', label: 'Vancouver', inText: '[n]', numbered: true },
  { value: 'gbt', label: 'GB/T 7714', inText: '[n]', numbered: true },
  { value: 'nature', label: 'Nature', inText: '[n]', numbered: true },
  { value: 'chicago', label: 'Chicago 著者-年', inText: '(Surname Year)', numbered: false },
  { value: 'springer', label: 'Springer', inText: '[n]', numbered: true },
  { value: 'acs', label: 'ACS', inText: '[n]', numbered: true },
];

/**
 * 单个作者元素归一化为展示用姓名字符串：
 *  - 字符串：直接 trim 使用（历史存储形态，路径逐字节不变）；
 *  - 对象：取 name；缺省时回退 family（再拼 given）——兼容知识库上传/SQL 直插产生的对象数组形态。
 * 其余不可解析值返回空串，由上层过滤。
 */
function authorToName(a: unknown): string {
  if (typeof a === 'string') return a.trim();
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
    if (typeof o.family === 'string' && o.family.trim()) {
      return typeof o.given === 'string' && o.given.trim() ? `${o.given.trim()} ${o.family.trim()}`.trim() : o.family.trim();
    }
  }
  return '';
}
/**
 * 解析 authors 字段为字符串作者数组。
 * 兼容：JSON 字符串（历史逗号/数组串）、已是对象/字符串数组（上传/SQL 直插）、null/空值。
 * 字符串数组路径与旧实现输出逐字节一致。
 */
function parseAuthorArr(authors: string | unknown[] | null | undefined): string[] {
  let raw: unknown = [];
  if (typeof authors === 'string') {
    try {
      raw = JSON.parse(authors || '[]');
    } catch {
      return [];
    }
  } else if (Array.isArray(authors)) {
    raw = authors;
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(authorToName).filter(Boolean);
}
/** "First Middle Last" -> "Last" */
function surnameOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : a;
}
/** "First Middle Last" -> "F. M." */
function initialsOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  parts.pop();
  return parts.map((p) => p.charAt(0).toUpperCase()).join('. ') + (parts.length ? '.' : '');
}

/** 质量分配色：≥good 默认色，good~mid 琥珀，<mid 红 */
const scoreColor = (v: number, good = 70, mid = 50) => (v >= good ? undefined : v >= mid ? '#f59e0b' : '#f87171');
/** 工具区小节标题统一类名（多处复用，缩小 bundle） */
const SEC = 'text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5';

type RefLite = { title: string; authors: string; year: number | null; venue: string; doi: string };

/** 单条参考文献条目渲染（文末列表）。inText 由 CITE_STYLES 描述，正文锚点恒为 [n] */
function formatRefEntry(ref: RefLite, format: string, index: number): string {
  const arr = parseAuthorArr(ref.authors);
  const year = ref.year ? `${ref.year}` : 'n.d.';
  const venue = ref.venue || '';
  const doi = ref.doi ? ` https://doi.org/${ref.doi}` : '';
  const t = ref.title || 'Untitled';

  // 作者串的几种约定
  const apaAuthors = arr.length === 0 ? 'Anonymous' : arr.length === 1 ? arr[0] : `${arr[0]} et al.`;
  const iniOf = (a: string) => initialsOf(a).replace(/\.\s?/g, '');
  const ieeeAuthors = arr.map((a) => (iniOf(a) ? `${initialsOf(a)} ${surnameOf(a)}` : surnameOf(a))).join(', ');
  const vanAuthors = arr.map((a) => `${surnameOf(a)} ${iniOf(a)}`.trim()).join(', ');
  const semiAuthors = arr.map((a) => `${surnameOf(a)}${iniOf(a) ? `, ${initialsOf(a)}` : ''}`).join('; ');
  const gbtAuthors = arr.length === 0 ? '佚名' : arr.length === 1 ? arr[0] : arr.length > 3 ? `${arr[0]} 等` : arr.join(', ');

  switch (format) {
    case 'ieee':
      return `[${index}] ${ieeeAuthors || 'Anonymous'} "${t},"${venue ? ` ${venue},` : ''} ${year}.${doi}`;
    case 'vancouver':
      return `${index}. ${vanAuthors || 'Anonymous'} ${t}.${venue ? ` ${venue}.` : ''} ${year}.${doi}`;
    case 'gbt':
      return `[${index}] ${gbtAuthors}. ${t}[J].${venue ? ` ${venue},` : ''} ${year}.${doi}`;
    case 'nature': {
      const names = arr.slice(0, 6).map((a) => `${iniOf(a)} ${surnameOf(a)}`.trim()).join(', ');
      return `[${index}] ${names || 'Anonymous'}${arr.length > 6 ? ' et al.' : ''}. ${t}. ${venue} ${year}.${doi}`;
    }
    case 'chicago': {
      const names =
        arr.length === 0 ? 'Anonymous' : arr.length === 1 ? arr[0] : arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
      return `${names}. ${year}. "${t}."${venue ? ` ${venue}.` : ''}${doi}`;
    }
    case 'springer':
    case 'acs':
      return `[${index}] ${semiAuthors || 'Anonymous'}. ${t}. ${venue} ${year}.${doi}`;
    case 'apa':
    default:
      return `${apaAuthors} (${year}). ${t}.${venue ? ` ${venue}.` : ''}${doi}`;
  }
}

/** 版本快照类型与 diff 逻辑拆至独立 chunk（VersionDiffModal，仅打开对比时加载） */
import type { VersionSnapshot } from './VersionDiffModal';
const VersionDiffModal = lazy(() => import('./VersionDiffModal').then((m) => ({ default: m.VersionDiffModal })));
/** 著者-年重排入口（按钮+预览 Modal）拆至独立 chunk，避免撑大 WritingPage */
const CiteReorderButton = lazy(() => import('./CiteReorderButton').then((m) => ({ default: m.CiteReorderButton })));
/** 导出区（Markdown/.tex/HTML/Word）：所有 .tex 与 HTML 生成、转义、转换逻辑收在独立 lazy chunk，写作页主 chunk 不增重 */
const DocExporter = lazy(() => import('./DocExporter').then((m) => ({ default: m.DocExporter })));

/** 取编辑器 textarea DOM 节点（ui.tsx 的 Textarea 未透传 ref，用 id 定位，不改 ui.tsx） */
function getEditorTa(): HTMLTextAreaElement | null {
  return typeof document === 'undefined' ? null : (document.getElementById('sciflow-editor') as HTMLTextAreaElement | null);
}

export function WritingPage({ project, initialDocId }: { project: Project; initialDocId: string | null }) {
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
  const [polishResult, setPolishResult] = useState<{ original: string; polished: string; reason: string } | null>(null);
  const [translateTarget, setTranslateTarget] = useState<'zh' | 'en'>('zh');
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'edit' : 'split'));
  const toast = useContext(ToastContext);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [history, setHistory] = useState<{ type: string; original: string; polished: string; reason: string }[]>([]);
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  const [exportFormat, setExportFormat] = useState('apa');
  const [exported, setExported] = useState<string[]>([]);
  const [abstractResult, setAbstractResult] = useState<{ abstract: string; keywords: string[] } | null>(null);
  const [designResult, setDesignResult] = useState<ResearchDesignResult | null>(null);
  const [designIdea, setDesignIdea] = useState('');
  const [reviewResult, setReviewResult] = useState<SimulatedReviewResult | null>(null);
  /* —— 审稿意见闭环状态 —— */
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [savingReply, setSavingReply] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [importingComments, setImportingComments] = useState(false);
  /* —— 连贯连通：最新质量评分 / 关联实验 / 文献库引用弹层 —— */
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [docExperiments, setDocExperiments] = useState<Experiment[]>([]);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
  const [citePickerOpen, setCitePickerOpen] = useState(false);
  const [addingCiteId, setAddingCiteId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* —— 版本历史 / 左右栏 diff —— */
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('current');
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<Doc | null>(null);
  /** 移动端工具面板切换：大纲 / AI 助手 / AI 工具 三者互斥，打开时编辑器全宽让位 */
  const [mobilePanel, setMobilePanel] = useState<'outline' | 'chat' | 'tools' | null>(null);

  const loadDocs = useCallback(async () => {
    const list = await api.documents.list(project.id);
    setDocs(list);
    setDocId((prev) => (list.some((d) => d.id === prev) ? prev : (list[0]?.id ?? null)));
  }, [project.id]);

  useEffect(() => {
    loadDocs().catch((e) => setError(e.message));
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
      .catch((e) => setError(e.message));
  }, [docId]);

  useEffect(() => {
    if (docId) {
      api.documents.citations(docId).then(setCitations).catch(() => setCitations([]));
      api.documents.polishRecords(docId).then(setHistory).catch(() => setHistory([]));
      // 审稿意见闭环：后端未就绪时优雅降级为空列表
      setCommentsLoading(true);
      api.research.reviewComments(docId)
        .then(setReviewComments)
        .catch(() => setReviewComments([]))
        .finally(() => setCommentsLoading(false));
      // 连贯连通：最新质量评分（null/失败→空态）与本文档关联实验（失败→空列表）
      api.quality.latest(docId).then(setQualityReport).catch(() => setQualityReport(null));
      api.experiments.byDocument(docId).then(setDocExperiments).catch(() => setDocExperiments([]));
    } else {
      setReviewComments([]);
      setQualityReport(null);
      setDocExperiments([]);
    }
  }, [docId]);

  // 立即保存（防抖自动保存与 ⌘S 共用；manual=true 时给出用户可见反馈）
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

  // 防抖自动保存
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

  // 写作页快捷键：⌘S 立即保存 / ⌘B 切换大纲栏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !docId) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault(); // 阻止浏览器"保存网页"对话框
        saveNow(true);
      } else if (k === 'b') {
        e.preventDefault(); // 阻止浏览器书签栏
        setShowOutlinePanel((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docId, saveNow]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setAiBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAiBusy(false);
    }
  };

  /** 章节字数分布：按 ## 切分正文（与 LaTeX 导出同一 split 口径） */
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

  /** 7 维质量评分维度（与 QualityPage 同口径；窄面板用 HBar 展示，不引雷达） */
  const QUALITY_DIMS = [
    { key: 'literature', label: '文献充分性' },
    { key: 'logic', label: '逻辑一致性' },
    { key: 'citation', label: '引用规范' },
    { key: 'language', label: '语言质量' },
    { key: 'novelty', label: '创新性' },
    { key: 'figures', label: '图表' },
    { key: 'format', label: '格式' },
  ];
  const qualityScores = useMemo(
    () => (qualityReport ? jsonText<Record<string, number>>(qualityReport.scores, {}) : {}),
    [qualityReport],
  );

  /** 版本快照列表：doc.versions 历史快照 + 当前编辑态（v=doc.version）。历史快照 content 为旧正文 */
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
      setDeletingDoc(null);
    }
  };

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
      // 简单处理：全部替换
      setContent((c) => c.replace(polishResult.original, polishResult.polished) || polishResult.polished);
    } else {
      setContent(polishResult.polished);
    }
    setPolishResult(null);
  };

  /** 在编辑器当前选区/光标处插入文本（锚点与实验结论共用），插入后光标落到插入内容末尾 */
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

  /** 任务1：基于选区/光标插入引用锚点 [n]（n=citations 顺序号 1-based）。
   *  - 未引用过：追加 citation 行（location=anchor:n，context=锚点前后各60字），n=追加后序号
   *  - 已引用过：不重复加行，仅在正文补一个 [n]（同一引用可多次锚定） */
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
      } catch (e: any) {
        setError(e.message);
      } finally {
        setAddingCiteId(null);
      }
    } else {
      toast('success', `已在光标处追加引用锚点 [${n}]`);
    }
  };

  /** 任务4：把关联实验的结论（+首图 Markdown）插入正文光标处 */
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

  /** 任务2：前端按所选样式渲染文末参考文献列表（8 种自实现，按 citations 顺序） */
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

  // 任务2：引用列表变化或切换样式时，自动按当前样式刷新文末列表预览（bibtex 仍手动拉后端）
  useEffect(() => {
    if (exportFormat !== 'bibtex' && citations.length > 0) {
      setExported(buildExportedList(exportFormat));
    }
  }, [citations, exportFormat, buildExportedList]);

  const exportRefs = async (format: string) => {
    setExportFormat(format);
    setError('');
    // bibtex 是整块 .bib，仍交后端；其余 8 种样式纯前端按 citations 顺序渲染
    if (format === 'bibtex') {
      try {
        setExported(await api.documents.exportCitations(docId!, 'bibtex'));
      } catch (e: any) {
        setError(e.message);
      }
      return;
    }
    setExported(buildExportedList(format));
  };

  /** 导出 Word(.docx)——交稿/投稿刚需 */
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

  /** 导出全文 Markdown（标题+大纲+正文+引用） */
  const exportFullDoc = () =>
    run(async () => {
      const { markdown, filename } = await api.documents.exportMarkdown(docId!);
      downloadText(filename, markdown, 'text/markdown;charset=utf-8');
      setError('');
    });

  /** 科研加强：生成论文摘要 + 关键词（AI） */
  const generateAbstract = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文，再生成摘要');
      const r = await api.documents.abstract(docId!);
      setAbstractResult(r);
      toast('success', '摘要与关键词已生成');
    });

  /** 科研加强：研究设计诊断（选题阶段：新颖性/可行性/风险/下一步） */
  const runDesignReview = () =>
    run(async () => {
      if (!designIdea.trim()) throw new Error('请先描述你的研究想法');
      const r = await api.research.designReview(designIdea.trim(), refs.map((x) => ({ title: x.title, year: x.year, venue: x.venue, abstract: x.abstract || '' })));
      setDesignResult(r);
      toast('success', '研究设计诊断完成');
    });

  /** 科研加强：模拟同行评审（3 位审稿人 + 主编综合决定） */
  const runSimulatedReview = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文');
      const r = await api.research.review(doc?.title || '未命名论文', content);
      setReviewResult(r);
      toast('success', '模拟同行评审完成');
    });

  /* —— 审稿意见闭环：状态切换 / 回复 / 删除 / 生成回复信 / 从模拟评审导入 —— */
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
    } catch (e: any) {
      setReviewComments((s) => s.map((x) => (x.id === c.id ? { ...x, status: prev } : x)));
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingReply(false);
    }
  };

  const removeComment = async (c: ReviewComment) => {
    setReviewComments((s) => s.filter((x) => x.id !== c.id));
    try {
      await api.research.removeReviewComment(c.id);
      toast('info', '已删除该条意见');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const generateResponseLetter = async () => {
    setGeneratingLetter(true);
    setError('');
    try {
      const r = await api.research.responseLetter(docId!);
      setLetter(r.letter);
      toast('success', 'Point-by-point 回复信已生成');
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImportingComments(false);
    }
  };

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
        <Card className={`flex-1 min-w-0 ${mobilePanel ? 'hidden md:flex' : 'flex'} flex-col`}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <input
              className="font-medium text-slate-800 dark:text-slate-100 outline-none flex-1 bg-transparent"
              defaultValue={doc.title}
              onBlur={async (e) => {
                const t = e.target.value.trim();
                if (t && t !== doc.title) {
                  const updated = await api.documents.update(docId!, { title: t });
                  setDoc(updated);
                  setDocs((s) => s.map((d) => (d.id === updated.id ? updated : d)));
                }
              }}
            />
            {savedAt && <span className="text-xs text-emerald-500 flex items-center gap-1 page-in"><Check size={12} />已保存</span>}
            <Badge tone="blue">v{doc.version}</Badge>
            {/* Markdown 预览切换（编辑 / 预览 / 分栏，科研写作标配） */}
            <div className="flex items-center gap-0.5 ml-auto bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {(['edit', 'split', 'preview'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEditorMode(m)}
                  title={m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-all duration-150 ${
                    editorMode === m ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/25' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {m === 'edit' ? <Pencil size={11} /> : m === 'preview' ? <Eye size={11} /> : <FileText size={11} />}
                  {m === 'edit' ? '编辑' : m === 'preview' ? '预览' : '分栏'}
                </button>
              ))}
            </div>
          </div>
          <div className={`flex-1 min-h-0 ${editorMode === 'split' ? 'flex' : ''}`}>
            {editorMode !== 'preview' && (
              <Textarea
                id="sciflow-editor"
                className={`flex-1 border-0 rounded-none focus:ring-0 focus:border-0 p-4 text-[13.5px] leading-relaxed ${editorMode === 'split' ? 'w-1/2 border-r border-slate-100 dark:border-slate-800' : 'w-full'}`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在这里撰写论文正文（支持 Markdown）…可使用右侧 AI 工具：大纲生成、章节起草、润色、翻译、降重"
              />
            )}
            {editorMode !== 'edit' && (
              <div className={`flex-1 overflow-y-auto p-4 text-[13.5px] leading-relaxed prose prose-sm prose-headings:font-semibold prose-a:text-teal-600 dark:prose-invert ${editorMode === 'split' ? 'w-1/2' : 'w-full'}`}>
                {content.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {content}
                  </ReactMarkdown>
                ) : (
                  <div className="text-slate-400 dark:text-slate-500 text-sm">预览区：开始撰写后将实时渲染 Markdown 效果（标题、加粗、引用、列表、代码块等）。</div>
                )}
              </div>
            )}
          </div>
        </Card>

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
                {/* 新颖性 / 可行性 双条 HBar（替代大数字；sub=反馈摘要，hint=完整反馈） */}
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
                {/* 3 位审稿人得分对比 HBar（替代分散 Badge；悬停看 concerns 摘要） */}
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

          {/* 审稿意见闭环（折叠卡片，默认收起；真实增删改查，不占位） */}
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

          {/* 质量评分（折叠卡片：最新一次 7 维评分；null/失败显示空态，不白屏） */}
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

          {/* 关联实验（折叠卡片：只读展示，不做一键插入正文） */}
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

          {/* 版本历史（任务3：左右栏 diff 对比 + 命名 + 恢复） */}
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

          {/* 引用管理 */}
          <div className="mb-4">
            <div className={`${SEC} flex items-center gap-1`}>
              <BookOpen size={12} /> 引用管理（文献库 {refs.length} 条）
            </div>
            {/* 引用核验率 Donut：citations 中 verified=1 占比 */}
            {citations.length > 0 && (() => {
              const verified = citations.filter((c) => c.verified === 1).length;
              const pct = Math.round((verified / citations.length) * 100);
              return (
                <div className="mb-2 rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <Donut
                    size={64}
                    thickness={9}
                    centerValue={`${pct}%`}
                    centerLabel="核验率"
                    segments={[
                      { label: `已核验 ${verified}`, value: verified, color: '#10b981' },
                      { label: `未核验 ${citations.length - verified}`, value: citations.length - verified, color: '#cbd5e1' },
                    ]}
                  />
                </div>
              );
            })()}
            {refs.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">文献库为空，请先到「文献调研」检索导入</div>
            ) : (
              <select
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-xs bg-white dark:bg-slate-900"
                onChange={(e) => {
                  if (e.target.value) insertCitationAnchor(e.target.value);
                  e.target.value = '';
                }}
                value=""
              >
                <option value="">先在正文点光标，再选文献插入 [n]…</option>
                {refs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title.slice(0, 40)}
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" className="text-xs w-full mt-1.5" onClick={() => setCitePickerOpen(true)} disabled={refs.length === 0}>
              <Plus size={12} /> 从文献库添加引用
            </Button>
            {citations.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">已引用 {citations.length} 条（序号即正文 [n]）</div>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {citations.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded px-2 py-1">
                      <span className="shrink-0 font-mono text-teal-600 dark:text-teal-400">[{i + 1}]</span>
                      <span className="truncate flex-1">{c.reference.title}</span>
                      <button
                        title="在正文光标处再插一个锚点"
                        className="shrink-0 text-slate-400 hover:text-teal-600"
                        onClick={() => insertCitationAnchor(c.referenceId)}
                      >
                        <Crosshair size={12} />
                      </button>
                      {c.verified ? <Badge tone="green">DOI✓</Badge> : <Badge>未核验</Badge>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-1.5 mt-2">
              <Select
                className="flex-1 text-xs"
                options={[...CITE_STYLES.map((s) => ({ value: s.value, label: s.label })), { value: 'bibtex', label: 'BibTeX (.bib)' }]}
                value={exportFormat}
                onChange={(v) => exportRefs(v)}
              />
              <Button variant="outline" className="text-xs" onClick={() => exportRefs(exportFormat)} disabled={citations.length === 0}>
                渲染列表
              </Button>
            </div>
            {/* 著者-年重排入口（独立 lazy chunk）：确认后 setContent→自动保存链 */}
            <Suspense fallback={null}>
              <CiteReorderButton docId={docId} style={exportFormat} citationsCount={citations.length} onApply={setContent} />
            </Suspense>
            {(() => {
              const meta = CITE_STYLES.find((s) => s.value === exportFormat);
              if (!meta) return null;
              return (
                <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                  文中引用：<span className="font-mono text-slate-500 dark:text-slate-400">{meta.inText}</span>
                  {!meta.numbered && '（锚点仍为 [n]，列表按引用序渲染）'}
                </div>
              );
            })()}
            {exported.length > 0 && (
              <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded p-2 text-xs text-slate-600 dark:text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {exported.map((e, i) => (
                  <div key={i} className="mb-1">
                    {e}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
              {/* 导出区（独立 lazy chunk）：Markdown / .tex / HTML 快照 / Word */}
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
            </div>
          </div>

          {/* 历史记录 */}
          {history.length > 0 && (
            <div>
              <div className={SEC}>润色 / 翻译历史（可追溯）</div>
              <div className="space-y-1.5">
                {history.slice(0, 6).map((h, i) => (
                  <details key={i} className="bg-slate-50 dark:bg-slate-900/50 rounded p-2 text-xs">
                    <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                      {h.type === 'polish' ? '润色' : h.type === 'reduce' ? '降重' : '翻译'} · {new Date().toLocaleTimeString()}
                    </summary>
                    <div className="mt-1 text-slate-400 dark:text-slate-500 max-h-20 overflow-y-auto">{h.reason}</div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 从文献库添加引用弹层：点选后幂等写入，成功后刷新引用列表/Donut，弹层保持打开可继续选 */}
      <Modal open={citePickerOpen} title="从文献库添加引用" onClose={() => setCitePickerOpen(false)} width="max-w-lg">
        {refs.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">文献库为空，请先到「文献调研」检索导入。</div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-0.5">
            {refs.map((r) => {
              const citedIdx = citations.findIndex((c) => c.referenceId === r.id);
              const cited = citedIdx >= 0;
              return (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-700 dark:text-slate-200 truncate">
                      {cited && <span className="font-mono text-teal-600 dark:text-teal-400 mr-1">[{citedIdx + 1}]</span>}
                      {r.title}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">{[r.year, r.venue].filter(Boolean).join(' · ')}</div>
                  </div>
                  {cited ? (
                    <Button
                      variant="outline"
                      className="text-xs px-2 py-1 shrink-0"
                      title="在正文光标处再插一个 [n] 锚点"
                      onClick={() => insertCitationAnchor(r.id)}
                    >
                      <Crosshair size={11} /> 插锚点
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="text-xs px-2 py-1 shrink-0"
                      title="加入引用并在正文光标处插入锚点"
                      disabled={addingCiteId === r.id || !docId}
                      onClick={() => insertCitationAnchor(r.id)}
                    >
                      {addingCiteId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

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
