import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_ENGINE_IDS, type EngineId } from "@/lib/engines";
import { runSpectra } from "@/lib/scrape/pipeline";
import type { SearchMode, SpectraResult } from "@/lib/scrape/types";
import { getXaiStatus } from "@/lib/xai";

const requestSchema = z.object({
  query: z.string().min(1).max(2000),
  mode: z.enum(["auto", "search", "url", "deep"]).optional(),
  engines: z.array(z.string()).optional(),
  maxPages: z.number().min(1).max(4).optional(),
  useAi: z.boolean().optional(),
});

export const spectraSearch = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }): Promise<SpectraResult> => {
    const engines =
      (data.engines?.filter(Boolean) as EngineId[] | undefined) ?? DEFAULT_ENGINE_IDS;
    return runSpectra({
      query: data.query,
      mode: (data.mode as SearchMode | undefined) ?? "auto",
      engines,
      maxPages: data.maxPages,
      useAi: data.useAi,
    });
  });

export const spectraAiStatus = createServerFn({ method: "GET" }).handler(async () => {
  return getXaiStatus();
});
