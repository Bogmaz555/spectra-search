/** Deep link that opens Firma / CapEx with the company already filled in. */
export function capexDeepLink(query: string): string {
  const q = query.trim().slice(0, 500);
  const params = new URLSearchParams();
  params.set("mode", "capex");
  params.set("q", q);
  return `/?${params.toString()}`;
}

/** Query string for „Zbadaj firmę”. Adds KRS when we already know it. */
export function capexInvestigateQuery(company: string, krs?: string): string {
  const name = company.trim();
  if (!krs) return name;
  if (name.includes(krs)) return name;
  return [name, `KRS ${krs}`].filter(Boolean).join(" ");
}

/** `?mode=capex&q=...` → the company query. Anything else stays closed. */
export function readCapexDeepLink(search: {
  mode?: string | null;
  q?: string | null;
}): string | null {
  if (search.mode !== "capex") return null;
  const q = search.q?.trim();
  if (!q) return null;
  return q.slice(0, 2000);
}
