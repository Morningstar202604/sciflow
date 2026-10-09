import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * LLM output parsing — pure functions (no DI)
 *
 * Kept separate so both AiService and AiTransportService (or any
 * future service) can share identical parse logic without depending on
 * a NestJS provider.
 * ------------------------------------------------------------------ */

/**
 * Extract the first balanced top-level JSON object out of an LLM reply.
 *
 * Handles the common "reasoning prefix" / "here is your JSON" chatter
 * that models prepend before the payload, and strips markdown fences
 * for the occasional model that still emits them.
 */
export function extractJsonObject(text: string): string {
  let cleaned = String(text ?? '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  // Fast path: already starts with a bracket
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) return balanced(cleaned);

  // Find the first `{` or `[` and match braces/brackets from there
  const startBrace = cleaned.indexOf('{');
  const startBracket = cleaned.indexOf('[');
  const start = pickFirst(startBrace, startBracket);
  if (start < 0) throw new Error('AI 输出不是有效 JSON');
  return balanced(cleaned.slice(start));
}

/** Walk `s` from offset 0 and return the shortest prefix whose braces/brackets balance. */
function balanced(s: string): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const open = s[0];
  const close: string | undefined = open === '{' ? '}' : open === '[' ? ']' : undefined;
  if (!close) throw new Error('AI 输出不是有效 JSON');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  throw new Error('AI 输出不是有效 JSON');
}

/** Smaller non-negative of two indices; -1 means "not found". */
function pickFirst(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/**
 * Parse a JSON object out of arbitrary text and validate it against a
 * zod schema.  Returns `null` (not throw) on any failure so callers can
 * fall back instead of crashing.
 */
export function safeParse<T>(text: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = JSON.parse(extractJsonObject(text)) as unknown;
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
