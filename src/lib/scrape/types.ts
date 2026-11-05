import type { EngineId } from "../engines.ts";

export type SearchMode = "auto" | "search" | "url" | "deep" | "capex";

/** Honest adapter outcome. `live` means the named integration actually ran. */
export type EngineStatus =
  | "pending"
  | "running"
  | "live"
  | "degraded"
  | "skipped"
  | "error";

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
  /** `spectra` for the local parser, or an EngineId when that API produced the field. */
  source: string;
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
  /** Provider id, or several ids joined when fusion merged the same URL. */
  source: string;
  score?: number;
}

export interface DiscoveryRun {
  id: string;
  label: string;
  status: "live" | "skipped" | "error";
  hits: number;
  durationMs: number;
  message: string;
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
  /** Present in CapEx mode: structured card for an opportunity (szansa). */
  capex?: import("./capex.ts").CapexCard;
}

export interface EffectivenessReport {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: { label: string; ok: boolean; detail: string }[];
}

export interface SpectraResult {
  query: string;
  mode: SearchMode;
  resolvedMode: "search" | "url" | "deep" | "capex";
  hits: SearchHit[];
  sources: SourceResult[];
  engines: EngineRun[];
  discovery: DiscoveryRun[];
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
