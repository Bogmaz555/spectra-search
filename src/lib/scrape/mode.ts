import type { SearchMode } from "./types.ts";
import { isUrl } from "../utils.ts";

export function resolveMode(query: string, mode: SearchMode): "search" | "url" | "deep" | "capex" {
  if (mode === "capex") return "capex";
  if (mode === "url") return "url";
  if (mode === "deep") return "deep";
  if (mode === "search") return "search";
  if (isUrl(query)) return "url";
  return "search";
}
