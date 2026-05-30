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

// Mirrors Prisma's `VideoLabel` enum. Hand-mirrored here (not derived
// from `@prisma/client`) because a Zod runtime schema needs literal
// strings, not a TS type. Adding a new label requires updating both
// schema.prisma and this list — that lockstep is on purpose; the
// harness is a downstream consumer that should fail closed on an
// unknown label rather than silently accept an unfamiliar value into
// baseline JSON.
export const VideoLabelSchema = z.enum([
  "COLLECTION",
  "EPISODE",
  "FEATURE_FILM",
  "SEGMENT",
  "SERIES",
  "SHORT_FILM",
  "TRAILER",
  "BEHIND_THE_SCENES",
])

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
  label: VideoLabelSchema.nullable(),
  durationSeconds: z.number().int().nullable(),
  childCount: z.number().int().nullable(),
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
