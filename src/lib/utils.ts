import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function isUrl(input: string): boolean {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return true;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(t) && !/\s/.test(t)) return true;
  return false;
}

export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}
