// Shorts Studio artifact contracts on the manager side (plan
// 2026-06-11-002). The artifact JSON shapes are PRODUCED by
// apps/shorts-worker (src/types.ts) — these zod parsers are the consumer
// half of that producer-consumer contract; literals must stay aligned with
// the worker (root CLAUDE.md: producer-consumer report-file contract).
//
// Pure module (zod only — no env, no services) so workflow steps, routes,
// and tests can import it freely.

import { z } from "zod"

// Artifact types under the SHORT's storage assetId (options.shorts.assetId).
export const SHORTS_CLIP_ARTIFACT_TYPE = "shorts-clip-v1"
export const SHORTS_CLIP_META_ARTIFACT_TYPE = "shorts-clip-meta-v1"
export const SHORTS_CAPTIONS_ARTIFACT_TYPE = "shorts-captions-v1"
export const SHORTS_OUTPUT_ARTIFACT_TYPE = "shorts-output-v1"
export const SHORTS_RENDER_META_ARTIFACT_TYPE = "shorts-render-meta-v1"
// Manager-written artifacts (not produced by the worker):
export const SHORTS_DRAFT_ARTIFACT_TYPE = "shorts-draft-v1"
export const SHORTS_RENDER_PROPS_ARTIFACT_TYPE = "shorts-render-props-v1"
export const SHORTS_MUX_OUTPUT_ARTIFACT_TYPE = "shorts-mux-output-v1"

// ---------------------------------------------------------------------------
// Worker-produced artifacts (consumer parsers)
// ---------------------------------------------------------------------------

// shorts-clip-meta-v1.json — written by the worker's prepare pipeline.
export const shortsClipMetaSchema = z.looseObject({
  sourceHost: z.string(),
  clip: z.looseObject({ startSec: z.number(), endSec: z.number() }),
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  hasAudio: z.boolean(),
  generatedAt: z.string(),
})

export type ShortsClipMeta = z.infer<typeof shortsClipMetaSchema>

// shorts-captions-v1.json — whisper word captions (immutable; operator edits
// live in the manager draft artifact). Caption entry shape matches
// @remotion/captions' Caption type.
export const shortsCaptionSchema = z.looseObject({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  timestampMs: z.number().nullable(),
  confidence: z.number().nullable(),
})

export const shortsCaptionsArtifactSchema = z.looseObject({
  captions: z.array(shortsCaptionSchema),
  language: z.string().nullable(),
  model: z.string().nullable(),
  annotation: z.string().nullable(),
  generatedAt: z.string(),
})

export type ShortsCaption = z.infer<typeof shortsCaptionSchema>
export type ShortsCaptionsArtifact = z.infer<
  typeof shortsCaptionsArtifactSchema
>

export function parseShortsClipMeta(value: unknown): ShortsClipMeta | null {
  const parsed = shortsClipMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseShortsCaptionsArtifact(
  value: unknown,
): ShortsCaptionsArtifact | null {
  const parsed = shortsCaptionsArtifactSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// shorts-render-meta-v1.json — written by the worker's render pipeline.
// `propsHash` here is the worker echoing back the manager-computed opaque
// token; matching it against the current resolve output is the render
// reuse-not-rerun provenance check.
export const shortsRenderMetaSchema = z.looseObject({
  propsHash: z.string(),
  renderedDraftVersion: z.number().int(),
  compositionsVersion: z.string(),
  generatedAt: z.string(),
})

export type ShortsRenderMeta = z.infer<typeof shortsRenderMetaSchema>

export function parseShortsRenderMeta(value: unknown): ShortsRenderMeta | null {
  const parsed = shortsRenderMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Prepare reuse-not-rerun decision (plan "Reuse-not-rerun")
// ---------------------------------------------------------------------------

// The worker prepare call is skipped only when the clip MP4 exists AND both
// JSON artifacts exist AND parse (provenance-checked skip — never
// `artifactExists` alone) AND the caller did not force. Extracted pure so
// the provenance path is unit-testable without the workflow runtime.
export function shouldSkipPrepareWorker(input: {
  force: boolean
  clipExists: boolean
  clipMeta: ShortsClipMeta | null
  captions: ShortsCaptionsArtifact | null
}): boolean {
  return (
    !input.force &&
    input.clipExists &&
    input.clipMeta !== null &&
    input.captions !== null
  )
}

// ---------------------------------------------------------------------------
// Mux output record (record-before-poll idempotency, smart-crop pattern)
// ---------------------------------------------------------------------------

// Written IMMEDIATELY after createMuxAsset returns (before readiness
// polling) so a step retry resumes polling the recorded asset instead of
// creating a duplicate billable Mux asset.
//
// `propsHash` is the render provenance the asset was created FROM: the Mux
// output step only reuses/resumes a record whose propsHash matches the
// current resolved hash — otherwise the record belongs to a previous render
// (the operator edited the draft and re-rendered) and a fresh asset must be
// created from the new output bytes. Optional in the parsed type ONLY for
// legacy records written before the field existed; those are treated as
// stale (never reused). The builder always requires it.
export type ShortsMuxOutputRecord = {
  version: 1
  kind: "shorts-mux-output"
  jobId: string
  muxAssetId: string
  propsHash?: string
  ready: boolean
  playbackId?: string
  createdAt: string
}

export function buildShortsMuxOutputRecord(input: {
  jobId: string
  muxAssetId: string
  propsHash: string
  ready: boolean
  playbackId?: string
  createdAt?: string
}): ShortsMuxOutputRecord {
  return {
    version: 1,
    kind: "shorts-mux-output",
    jobId: input.jobId,
    muxAssetId: input.muxAssetId,
    propsHash: input.propsHash,
    ready: input.ready,
    ...(input.playbackId ? { playbackId: input.playbackId } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function parseShortsMuxOutputRecord(
  value: unknown,
): ShortsMuxOutputRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    record.kind !== "shorts-mux-output" ||
    typeof record.jobId !== "string" ||
    typeof record.muxAssetId !== "string" ||
    typeof record.ready !== "boolean"
  ) {
    return null
  }

  return {
    version: 1,
    kind: "shorts-mux-output",
    jobId: record.jobId,
    muxAssetId: record.muxAssetId,
    // Legacy records have no propsHash — parsed as undefined, which never
    // matches a real hash, so they are treated as stale and recreated.
    propsHash:
      typeof record.propsHash === "string" ? record.propsHash : undefined,
    ready: record.ready,
    playbackId:
      typeof record.playbackId === "string" ? record.playbackId : undefined,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date(0).toISOString(),
  }
}
