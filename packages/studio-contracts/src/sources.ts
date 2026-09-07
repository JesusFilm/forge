import { z } from "zod"
import {
  studioIdSchema,
  studioSourceSchema,
  studioDigestSchema,
  studioAssetReferenceSchema,
} from "./index"
export const studioCaptureSourceSchema = z
  .object({
    videoId: studioIdSchema,
    dubId: studioIdSchema,
    editionId: studioIdSchema,
    language: studioIdSchema,
    trackId: studioIdSchema,
    downloadId: studioIdSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    idempotencyKey: studioIdSchema,
    retainOriginalBytes: z.boolean().default(false),
  })
  .strict()
export const studioSourceSnapshotSchema = z
  .object({
    id: studioIdSchema,
    source: studioSourceSchema,
    durationMs: z.number().int().positive(),
    downloadId: studioIdSchema,
    hlsUrl: z.string().url(),
    downloadUrl: z.string().url(),
    subtitleUrl: z.string().url(),
    catalogDigest: studioDigestSchema,
    restrictions: z.array(z.string()),
    materialization: z.enum([
      "descriptor",
      "original-bytes",
      "broker-manifest",
    ]),
    originalByteDigest: studioDigestSchema.nullable(),
    coveredRanges: z
      .array(
        z
          .object({
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().positive(),
          })
          .strict(),
      )
      .max(128),
    exportHeight: z.number().int().positive().nullable(),
    subtitlePrimary: z.boolean(),
    subtitleAiGenerated: z.boolean(),
  })
  .strict()
export type StudioSourceSnapshot = z.infer<typeof studioSourceSnapshotSchema>
export const studioSourceManifestSchema = z
  .object({
    sourceSnapshotId: studioIdSchema,
    catalogDigest: studioDigestSchema,
    purpose: z.enum(["preview", "export"]),
    height: z.number().int().positive(),
    ranges: z
      .array(
        z
          .object({
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    media: z.array(studioAssetReferenceSchema).min(1).max(128),
  })
  .strict()
export const studioMaterializeSourceSchema = z
  .object({
    sourceSnapshotId: studioIdSchema,
    preview: studioAssetReferenceSchema,
    export: studioAssetReferenceSchema,
    idempotencyKey: studioIdSchema,
  })
  .strict()
export type StudioSubtitleCue = { startMs: number; endMs: number; text: string }
export class StudioSourceError extends Error {}
export function parseStudioVtt(
  bytes: Uint8Array,
  range?: { startMs: number; endMs: number },
): StudioSubtitleCue[] {
  if (
    range &&
    (!Number.isInteger(range.startMs) ||
      !Number.isInteger(range.endMs) ||
      range.startMs < 0 ||
      range.endMs <= range.startMs)
  )
    throw new StudioSourceError("Invalid subtitle range")
  if (bytes.byteLength > 1048576)
    throw new StudioSourceError("Subtitle exceeds 1 MiB")
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
  if (!/^WEBVTT(?:\s|$)/.test(text))
    throw new StudioSourceError("Canonical WEBVTT required")
  const timestamp = (s: string) => {
    if (!/^(?:\d+:)?[0-5]\d:[0-5]\d\.\d{3}$/.test(s))
      throw new StudioSourceError("Invalid subtitle timestamp")
    return Math.round(
      s.split(":").reduce((a, p) => a * 60 + Number(p), 0) * 1000,
    )
  }
  return text
    .split(/\n\s*\n/)
    .slice(1)
    .flatMap((block) => {
      if (!block.trim() || /^NOTE(?:\s|$)/.test(block)) return []
      const lines = block.split("\n")
      const index = lines.findIndex((l) => l.includes(" --> "))
      if (index < 0 || index > 1)
        throw new StudioSourceError("Unsupported subtitle block")
      const [start, end] = lines[index]!.split(" --> ")
      const startMs = timestamp(start!),
        endMs = timestamp(end!.split(" ")[0]!)
      const cueText = lines
        .slice(index + 1)
        .join("\n")
        .trim()
      if (endMs <= startMs)
        throw new StudioSourceError("Invalid subtitle timing")
      if (range && (endMs <= range.startMs || startMs >= range.endMs)) return []
      if (!cueText || /[<>]/.test(cueText))
        throw new StudioSourceError("Unsupported subtitle cue")
      return [{ startMs, endMs, text: cueText }]
    })
}
export function mapStudioSourceCues(
  cues: StudioSubtitleCue[],
  ranges: { startMs: number; endMs: number; startFrame: number }[],
  fps: number,
) {
  if (!Number.isInteger(fps) || fps < 1 || fps > 120)
    throw new StudioSourceError("Invalid FPS")
  return ranges.flatMap((r, rangeIndex) => {
    if (
      r.startMs < 0 ||
      r.endMs <= r.startMs ||
      !Number.isInteger(r.startFrame) ||
      r.startFrame < 0
    )
      throw new StudioSourceError("Invalid range")
    return cues
      .filter((c) => c.startMs < r.endMs && c.endMs > r.startMs)
      .map((c) => ({
        rangeIndex,
        text: c.text,
        startFrame:
          r.startFrame +
          ((Math.max(c.startMs, r.startMs) - r.startMs) * fps) / 1000,
        endFrame:
          r.startFrame +
          ((Math.min(c.endMs, r.endMs) - r.startMs) * fps) / 1000,
      }))
  })
}

export const studioSourcePreviewSchema = z
  .object({
    sourceSnapshotId: studioIdSchema,
    language: studioIdSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()

/** Pages complete cues without truncating source text or hiding remaining coverage. */
export function pageStudioSourceCues(
  all: StudioSubtitleCue[],
  offset: number,
  limit: number,
) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > all.length ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new StudioSourceError("Invalid subtitle page")
  const cues: StudioSubtitleCue[] = []
  let size = 2
  for (const cue of all.slice(offset, offset + limit)) {
    const nextSize = new TextEncoder().encode(JSON.stringify(cue)).length + 1
    if (size + nextSize > 32768) {
      if (!cues.length)
        throw new StudioSourceError(
          "Canonical subtitle cue exceeds preview page capacity",
        )
      break
    }
    cues.push(cue)
    size += nextSize
  }
  const next = offset + cues.length
  return {
    cues,
    totalCues: all.length,
    nextOffset: next < all.length ? next : null,
  }
}
