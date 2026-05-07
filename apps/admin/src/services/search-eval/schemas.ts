/**
 * Shared Zod schemas for the search-eval harness.
 *
 * The same SearchResult shape was previously declared three times
 * (baseline.ts, calibration.ts, plus a hand-rolled type-guard in
 * search-client.ts). Drift between the copies was a silent footgun
 * — admin's REST search adding a field would have meant updating
 * three call sites in lockstep. Single source of truth here; all
 * search-eval modules import from this file.
 */

import { z } from "zod"

export const SearchResultSchema = z.object({
  type: z.enum(["video", "experience"]),
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  snippet: z.string(),
  startSeconds: z.number().nullable(),
  playbackId: z.string().nullable(),
  score: z.number(),
})

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  hasMore: z.boolean(),
  query: z.string(),
  searchMode: z.enum(["hybrid", "keyword-only"]),
})

export const FingerprintSlotSchema = z.object({
  count: z.number().int().min(0),
  maxUpdatedAt: z.string().nullable(),
})

export const FingerprintSchema = z.object({
  sceneEmbeddings: FingerprintSlotSchema,
  transcriptEmbeddings: FingerprintSlotSchema,
  experiences: FingerprintSlotSchema,
})
