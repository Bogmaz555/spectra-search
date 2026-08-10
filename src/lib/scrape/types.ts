import type { EngineId } from "@/lib/engines";

export type SearchMode = "auto" | "search" | "url" | "deep";

export type EngineStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface EngineRun {
  id: EngineId;
  status: EngineStatus;
  durationMs: number;
  message: string;
  itemsFound?: number;
}

export interface ExtractedLink {
  href: string;
  text: string;
  external: boolean;
}

export interface ExtractedMedia {
  type: "image" | "video" | "icon";
  src: string;
  alt?: string;
}

export interface StructuredField {
  key: string;
  value: string;
  source: EngineId;
}

export interface PatternGroup {
  label: string;
  items: string[];
  confidence: number;
}

export interface InteractiveElement {
  tag: string;
  type?: string;
  name?: string;
  text?: string;
  href?: string;
}

export interface MobileInsight {
  viewport?: string;
  hasAppLinks: boolean;
  appleItunes?: string;
  playStore?: string;
  themeColor?: string;
  isMobileOptimized: boolean;
}

export interface SourceResult {
  url: string;
  title: string;
  description: string;
  markdown: string;
  textPreview: string;
  links: ExtractedLink[];
  media: ExtractedMedia[];
  structured: StructuredField[];
  patterns: PatternGroup[];
  interactive: InteractiveElement[];
  mobile: MobileInsight;
  wordCount: number;
  statusCode: number;
  contentType: string;
  engines: EngineRun[];
  fetchedAt: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  source: "duckduckgo" | "wikipedia" | "direct";
}

export interface SpectraAi {
  enabled: boolean;
  used: boolean;
  model: string;
  answer: string;
  keyPoints: string[];
  confidence: number;
  citations: { title: string; url: string }[];
  error?: string;
}

export interface EffectivenessReport {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: { label: string; ok: boolean; detail: string }[];
}

export interface SpectraResult {
  query: string;
  mode: SearchMode;
  resolvedMode: "search" | "url" | "deep";
  hits: SearchHit[];
  sources: SourceResult[];
  engines: EngineRun[];
  summary: string;
  totalDurationMs: number;
  startedAt: string;
  finishedAt: string;
  ai: SpectraAi;
  effectiveness: EffectivenessReport;
}

export interface SpectraRequest {
  query: string;
  mode?: SearchMode;
  engines?: EngineId[];
  maxPages?: number;
  /** When true and XAI_API_KEY is set, run Grok synthesis */
  useAi?: boolean;
}
