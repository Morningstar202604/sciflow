export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface Doc {
  id: string;
  projectId: string;
  title: string;
  content: string;
  outline: string;
  version: number;
  versions: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutlineSection {
  title: string;
  subsections: string[];
}
export interface Outline {
  title: string;
  sections: OutlineSection[];
}

export interface Reference {
  id: string;
  projectId: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: string;
  tags: string;
  citationCount: number;
  createdAt: number;
}

export interface CitationRow {
  id: string;
  documentId: string;
  referenceId: string;
  location: string;
  context: string;
  format: string;
  verified: number;
  createdAt: number;
  reference: Reference;
}

export interface QualityReport {
  id: string;
  documentId: string;
  totalScore: number;
  scores: string;
  feedback: string;
  createdAt: number;
}

export interface PipelineStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'retry' | 'failed';
  output?: string;
  retryCount: number;
}

export interface PipelineTask {
  id: string;
  projectId: string;
  documentId: string | null;
  topic: string;
  currentStep: string;
  status: 'running' | 'awaiting_confirmation' | 'completed' | 'failed';
  steps: PipelineStep[];
  retryCount: number;
  lastError: string;
  createdAt: number;
  updatedAt: number;
}

export interface PolishRecord {
  id: string;
  documentId: string;
  type: string;
  original: string;
  polished: string;
  reason: string;
  createdAt: number;
}

export interface KnowledgeDoc {
  id: string;
  projectId: string;
  name: string;
  type: string;
  chunkCount: number;
  createdAt: number;
}

export interface KnowledgeSource {
  docName: string;
  snippet: string;
  score: number;
}

export interface KnowledgeQueryResult {
  answer: string;
  sources: KnowledgeSource[];
}

export interface ExtractedPaper {
  ref: string;
  title: string;
  year: number;
  method: string;
  results: string;
  contribution: string;
  limitations: string;
}

export interface EvidenceStance {
  claim: string;
  stance: string;
  count: number;
  refs: string[];
  note: string;
}

export interface EvidenceResult {
  summary: string;
  stances: EvidenceStance[];
}

export interface AppSettings {
  ai: { baseUrl: string; model: string; configured: boolean; models: string[] };
  env: { node: string; database: string; port: number };
  sources: { literature: string[] };
}

export interface SelfCheck {
  database: { ok: boolean; path: string };
  ai: { configured: boolean; ok: boolean; model: string; latencyMs: number; detail: string };
  timestamp: number;
}
