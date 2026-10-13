import { createHash } from "node:crypto"

import type { Chunk, SourceCatalog, Video } from "./source-generation"

export class SelectedTranscriptError extends Error {
  readonly code = "input_stale" as const

  constructor(
    readonly reason:
      | "chunk_order_changed"
      | "cursor_stalled"
      | "selected_transcript_incomplete",
  ) {
    super("input_stale")
  }
}

/** The exact selected-chunk digest used by the existing catalog build. */
export function validateSelectedChunks(
  video: Video,
  chunks: readonly Chunk[],
): { chunkDigest: string; hasNonEnglish: boolean } {
  const hash = createHash("sha256")
  const selected = video.transcriptSelection
    ? new Map(
        video.transcriptSelection.selected.map((item) => [
          item.transcriptId,
          item,
        ]),
      )
    : null
  if (selected && selected.size !== video.transcriptSelection?.selected.length)
    throw new SelectedTranscriptError("selected_transcript_incomplete")
  const indices = new Map<string, Set<number>>()
  let lastChunkId: string | undefined
  let hasNonEnglish = false
  for (const chunk of chunks) {
    if (lastChunkId && chunk.id <= lastChunkId)
      throw new SelectedTranscriptError("chunk_order_changed")
    if (selected) {
      const transcript = selected.get(chunk.transcriptId)
      if (
        !transcript ||
        transcript.language !== chunk.language ||
        chunk.chunkIndex < 0 ||
        chunk.chunkIndex >= transcript.totalChunks
      )
        throw new SelectedTranscriptError("selected_transcript_incomplete")
      const seen = indices.get(chunk.transcriptId) ?? new Set<number>()
      if (seen.has(chunk.chunkIndex))
        throw new SelectedTranscriptError("selected_transcript_incomplete")
      seen.add(chunk.chunkIndex)
      indices.set(chunk.transcriptId, seen)
    }
    lastChunkId = chunk.id
    hasNonEnglish ||= chunk.language !== "en"
    hash.update(
      JSON.stringify([
        chunk.id,
        chunk.transcriptId,
        chunk.language,
        chunk.chunkIndex,
        chunk.text,
      ]),
    )
  }
  if (
    selected &&
    (selected.size !== indices.size ||
      [...selected].some(
        ([id, transcript]) => indices.get(id)?.size !== transcript.totalChunks,
      ))
  )
    throw new SelectedTranscriptError("selected_transcript_incomplete")
  return { chunkDigest: hash.digest("hex"), hasNonEnglish }
}

/** Pages are read at the caller's frozen cutoff, then validated as one complete selection. */
export async function readCompleteSelectedChunks(
  catalog: SourceCatalog,
  video: Video,
  cutoff: string,
): Promise<{
  chunks: Chunk[]
  chunkDigest: string
  hasNonEnglish: boolean
}> {
  const chunks: Chunk[] = []
  let afterChunkId: string | undefined
  const seenCursors = new Set<string>()
  const expected = video.transcriptSelection?.selected.reduce(
    (total, item) => total + item.totalChunks,
    0,
  )
  let pageCount = 0
  do {
    pageCount += 1
    if (expected !== undefined && pageCount > expected + 1)
      throw new SelectedTranscriptError("cursor_stalled")
    const page = await catalog.chunks({
      videoId: video.id,
      cutoff,
      afterChunkId,
    })
    chunks.push(...page.chunks)
    if (expected !== undefined && chunks.length > expected)
      throw new SelectedTranscriptError("selected_transcript_incomplete")
    if (page.nextCursor && seenCursors.has(page.nextCursor))
      throw new SelectedTranscriptError("cursor_stalled")
    if (page.nextCursor) seenCursors.add(page.nextCursor)
    afterChunkId = page.nextCursor ?? undefined
  } while (afterChunkId)
  return { chunks, ...validateSelectedChunks(video, chunks) }
}
