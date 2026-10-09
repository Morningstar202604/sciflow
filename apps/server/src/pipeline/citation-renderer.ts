/**
 * CitationRenderer — pure logic for rendering [Ref:N] numbered citations.
 *
 * Extracted from PipelineService to keep citation-rendering logic self-contained
 * and testable.  Not @Injectable — instantiated directly by PipelineService.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { parseStringList } from '../common/json-guard';
import type * as schema from '../db/schema';
import { references, citations } from '../db/schema';
import type { Reference } from '../db/schema';
import type { PaperHit } from '../references/references.service';

/** Location + context snapshot for a single citation anchor */
export interface CitationSpot {
  location: string;
  context: string;
}

/** Result of scanning a document body for citation anchors */
export interface CitationScanResult {
  poolSpot: Map<number, CitationSpot>;
  suppSpot: Map<number, CitationSpot>;
}

export class CitationRenderer {
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  /**
   * Render [Ref:N] / [补充Ref:N] anchors to numbered citations [1], [2], ...
   * and append a reference list block.  Side-effect: back-fills citation rows.
   */
  render(
    documentId: string,
    content: string,
    refPool: Reference[],
    supplementHits: PaperHit[] = [],
    suppRefIds: (string | null)[] = [],
    libScore: Map<string, number> = new Map(),
    knowledgeHits: PaperHit[] = [],
  ): string {
    if (!content) return content;
    const refs = refPool;
    const { poolSpot, suppSpot } = this.scanCitationSpots(content, refs.length, supplementHits.length);
    const used = new Set<number>();
    content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; if (refs[idx]) used.add(idx); return ''; });
    const order = [...used].sort((a, b) => a - b);
    const numOf = new Map(order.map((idx, k) => [idx, k + 1]));
    const usedSupp = new Set<number>();
    content.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; if (supplementHits[idx]) usedSupp.add(idx); return ''; });
    const suppOrder = [...usedSupp].sort((a, b) => a - b);
    const base = order.length;
    const suppNum = new Map(suppOrder.map((idx, k) => [idx, base + k + 1]));

    let out = content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; return numOf.has(idx) ? `[${numOf.get(idx)}]` : `[文献${n}]`; });
    out = out.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; return suppNum.has(idx) ? `[${suppNum.get(idx)}]` : '[补充文献]'; });

    const list: string[] = [];
    for (const idx of order) {
      const r = refs[idx];
      const authors = parseStringList(r.authors).join(', ') || '佚名';
      const score = libScore.get(r.title);
      const tag = typeof score === 'number' ? `（文献库 · 匹配 ${score.toFixed(2)}）` : '';
      list.push(`[${list.length + 1}] ${authors}. ${r.title}[J].${r.venue ? ` ${r.venue},` : ''} ${r.year ? `${r.year}.` : 'n.d.'}${r.doi ? ` https://doi.org/${r.doi.replace(/^https?:\/\//, '')}` : ''}${tag}`);
    }
    for (const idx of suppOrder) {
      const h = supplementHits[idx];
      const authors = (h.authors || []).join(', ') || '佚名';
      list.push(`[${list.length + 1}] ${authors}. ${h.title}[J].${h.venue ? ` ${h.venue},` : ''} ${h.year ? `${h.year}.` : 'n.d.'}${h.doi ? ` https://doi.org/${h.doi.replace(/^https?:\/\//, '')}` : ''}`);
    }

    const blocks: string[] = [];
    if (list.length) blocks.push(list.join('\n'));
    if (knowledgeHits.length) {
      const knLines = knowledgeHits.map((k) => `- 《${k.title}》（知识库 · 匹配 ${(k.matchScore ?? 0).toFixed(2)}）：${(k.abstract || '').slice(0, 100).trim()}`).join('\n');
      blocks.push(`### 知识库参考（研究阶段本地检索）\n\n${knLines}`);
    }
    if (blocks.length) out += `\n\n## 参考文献\n\n${blocks.join('\n\n')}`;

    this.backfillCitations(documentId, refs, order, suppOrder, suppRefIds, poolSpot, suppSpot);
    return out;
  }

  /** Find all [Ref:N] / [补充Ref:N] anchors and record their section + context */
  scanCitationSpots(content: string, poolSize: number, suppSize: number): CitationScanResult {
    const poolSpot = new Map<number, CitationSpot>();
    const suppSpot = new Map<number, CitationSpot>();
    const tokenRe = /(#{1,6}\s+[^\n]+)|\[Ref:(\d+)\]|\[补充Ref:(\d+)\]/g;
    let m: RegExpExecArray | null;
    let section = '';
    while ((m = tokenRe.exec(content)) !== null) {
      if (m[1] !== undefined) section = m[1].replace(/^#{1,6}\s+/, '').trim();
      else if (m[2] !== undefined) { const idx = Number(m[2]) - 1; if (idx >= 0 && idx < poolSize && !poolSpot.has(idx)) poolSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) }); }
      else if (m[3] !== undefined) { const idx = Number(m[3]) - 1; if (idx >= 0 && idx < suppSize && !suppSpot.has(idx)) suppSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) }); }
    }
    return { poolSpot, suppSpot };
  }

  /** Persist citation rows (idempotent; skips existing refs) */
  backfillCitations(
    documentId: string,
    refs: Reference[],
    order: number[],
    suppOrder: number[],
    suppRefIds: (string | null)[],
    poolSpot: Map<number, CitationSpot>,
    suppSpot: Map<number, CitationSpot>,
  ): void {
    try {
      const existing = this.db.select().from(citations).where(eq(citations.documentId, documentId)).all();
      const have = new Set(existing.map((c) => c.referenceId));
      const now = Date.now();
      const insertOne = (referenceId: string, spot: CitationSpot | undefined, doi: string) => {
        if (!referenceId || have.has(referenceId)) return;
        this.db.insert(citations).values({ id: randomUUID(), documentId, referenceId, location: spot?.location || '', context: spot?.context || '', format: 'pipeline', verified: doi ? 1 : 0, createdAt: now }).run();
        have.add(referenceId);
      };
      for (const idx of order) { const r = refs[idx]; if (!r) continue; insertOne(r.id, poolSpot.get(idx), r.doi || ''); }
      for (const idx of suppOrder) {
        const refId = suppRefIds[idx];
        if (!refId) continue;
        const ref = this.db.select().from(references).where(eq(references.id, refId)).get();
        insertOne(refId, suppSpot.get(idx), ref?.doi || '');
      }
    } catch (e: any) {
      // swallow — citation back-fill is best-effort
    }
  }

  private contextAround(text: string, at: number, len: number): string {
    return text.slice(Math.max(0, at - 40), Math.min(text.length, at + len + 40)).replace(/\s+/g, ' ').trim();
  }
}
