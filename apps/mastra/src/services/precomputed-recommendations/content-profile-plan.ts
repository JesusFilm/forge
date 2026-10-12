import { createHash } from "node:crypto"

import { validateSelectedChunks } from "./selected-transcript"
import type { Chunk, Video } from "./source-generation"

const PLAN_REVISION = "complete-selected-profile-plan-v1"

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Route/playback availability and historical observations are not content. */
export function contentProfileMetadata(video: Video) {
  return {
    videoId: video.id,
    coreId: video.coreId,
    locale: video.locale,
    title: video.title,
    description: video.description,
    descriptionTruncated: video.descriptionTruncated,
    keywords: [...video.keywords],
    keywordsTruncated: video.keywordsTruncated,
    bibleCitations: [...video.bibleCitations],
    bibleCitationsTruncated: video.bibleCitationsTruncated,
    parentVideoIds: [...video.parentVideoIds],
    childVideoIds: [...video.childVideoIds],
    // Selection diagnostics are not content. A new unselected transcript or
    // playback language must not invalidate a profile built from the same
    // complete selected chunk set.
    transcriptSelection: video.transcriptSelection && {
      policy: video.transcriptSelection.policy,
      selected: video.transcriptSelection.selected.map((item) => ({ ...item })),
    },
  }
}

export type ProfileFragment = {
  chunkId: string
  transcriptId: string
  language: string
  chunkIndex: number
  fragmentIndex: number
  startChar: number
  endChar: number
  text: string
}

export type ProfilePart = {
  input: {
    metadata: ReturnType<typeof contentProfileMetadata>
    partIndex: number
    fragments: ProfileFragment[]
  }
  inputBytes: number
  partDigest: string
}

export type ContentProfilePlan = {
  cacheKey: string
  metadataDigest: string
  chunkDigest: string
  metadata: ReturnType<typeof contentProfileMetadata>
  metadataOnly: boolean
  hasNonEnglish: boolean
  selectedTranscriptCount: number
  selectedChunkCount: number
  sourceTextBytes: number
  plannedInputBytes: number
  parts: ProfilePart[]
}

export class ContentProfilePlanError extends Error {
  constructor(
    readonly code:
      | "selection_unavailable"
      | "identity_invalid"
      | "part_budget_invalid"
      | "part_budget_too_small",
  ) {
    super(code)
  }
}

function inputBytes(input: ProfilePart["input"]): number {
  return Buffer.byteLength(JSON.stringify(input), "utf8")
}

/** Pure byte planner: every selected character appears in exactly one part. */
export function planContentProfile(input: {
  video: Video
  chunks: readonly Chunk[]
  maxPartBytes: number
  modelId: string
  backend: string
  promptVersion: string
  schemaVersion: string
}): ContentProfilePlan {
  const { video, chunks, maxPartBytes } = input
  if (
    !video.transcriptSelection ||
    video.transcriptSelection.policy !==
      "english-per-edition-with-complete-fallback-v1"
  )
    throw new ContentProfilePlanError("selection_unavailable")
  if (
    [
      input.modelId,
      input.backend,
      input.promptVersion,
      input.schemaVersion,
    ].some((part) => !part || part !== part.trim())
  )
    throw new ContentProfilePlanError("identity_invalid")
  if (!Number.isSafeInteger(maxPartBytes) || maxPartBytes <= 0)
    throw new ContentProfilePlanError("part_budget_invalid")
  const { chunkDigest, hasNonEnglish } = validateSelectedChunks(video, chunks)
  const metadata = contentProfileMetadata(video)
  const metadataDigest = digest(metadata)
  const byTranscript = new Map<string, Chunk[]>()
  for (const chunk of chunks) {
    const existing = byTranscript.get(chunk.transcriptId) ?? []
    existing.push(chunk)
    byTranscript.set(chunk.transcriptId, existing)
  }
  const ordered = video.transcriptSelection.selected.flatMap((selection) =>
    (byTranscript.get(selection.transcriptId) ?? []).sort(
      (a, b) => a.chunkIndex - b.chunkIndex,
    ),
  )
  const parts: ProfilePart[] = []
  let fragments: ProfileFragment[] = []
  const envelope = (next: ProfileFragment[]) => ({
    metadata,
    partIndex: parts.length,
    fragments: next,
  })
  const fits = (next: ProfileFragment[]) =>
    inputBytes(envelope(next)) <= maxPartBytes
  if (chunks.length && !fits([]))
    throw new ContentProfilePlanError("part_budget_too_small")
  const flush = () => {
    if (!fragments.length) return
    const data = envelope(fragments)
    parts.push({
      input: data,
      inputBytes: inputBytes(data),
      partDigest: digest(data),
    })
    fragments = []
  }
  for (const chunk of ordered) {
    const points = Array.from(chunk.text)
    let pointOffset = 0
    let charOffset = 0
    let fragmentIndex = 0
    do {
      const remainder = points.slice(pointOffset).join("")
      const candidate: ProfileFragment = {
        chunkId: chunk.id,
        transcriptId: chunk.transcriptId,
        language: chunk.language,
        chunkIndex: chunk.chunkIndex,
        fragmentIndex,
        startChar: charOffset,
        endChar: charOffset + remainder.length,
        text: remainder,
      }
      if (fits([...fragments, candidate])) {
        fragments.push(candidate)
        break
      }
      if (fragments.length) {
        flush()
        continue
      }
      // A complete chunk does not fit an empty part. Split at Unicode scalar
      // boundaries, measuring the actual JSON UTF-8 payload each time.
      let low = 1
      let high = points.length - pointOffset
      let accepted = 0
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const text = points.slice(pointOffset, pointOffset + mid).join("")
        const fragment = {
          ...candidate,
          endChar: charOffset + text.length,
          text,
        }
        if (fits([fragment])) {
          accepted = mid
          low = mid + 1
        } else high = mid - 1
      }
      if (!accepted) throw new ContentProfilePlanError("part_budget_too_small")
      const text = points.slice(pointOffset, pointOffset + accepted).join("")
      fragments.push({
        ...candidate,
        endChar: charOffset + text.length,
        text,
      })
      pointOffset += accepted
      charOffset += text.length
      fragmentIndex += 1
      flush()
    } while (
      pointOffset < points.length ||
      (points.length === 0 && fragmentIndex === 0)
    )
  }
  flush()
  return {
    cacheKey: digest({
      revision: PLAN_REVISION,
      videoId: video.id,
      metadataDigest,
      chunkDigest,
      modelId: input.modelId,
      backend: input.backend,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      partDigests: parts.map((part) => part.partDigest),
    }),
    metadataDigest,
    chunkDigest,
    metadata,
    metadataOnly: chunks.length === 0,
    hasNonEnglish,
    selectedTranscriptCount: video.transcriptSelection.selected.length,
    selectedChunkCount: chunks.length,
    sourceTextBytes: chunks.reduce(
      (total, chunk) => total + Buffer.byteLength(chunk.text, "utf8"),
      0,
    ),
    plannedInputBytes: parts.reduce(
      (total, part) => total + part.inputBytes,
      0,
    ),
    parts,
  }
}
