// Phase 1: Smart Chunking — group source VTT segments into logical thought blocks
// of ~3-5 segments based on sentence boundaries. Purely algorithmic, no LLM call.

import type { TranscriptSegment, Chunk } from "./types"

const SENTENCE_ENDINGS = /[.!?。！？…]+\s*$/
const DEFAULT_TARGET_SIZE = 4
const MAX_CHUNK_SIZE = 6

/**
 * Group segments into thought blocks of ~targetSize.
 * Breaks at sentence boundaries when possible.
 * Guarantees full coverage with no gaps.
 */
export function chunkSegments(
  segments: TranscriptSegment[],
  targetSize: number = DEFAULT_TARGET_SIZE,
): Chunk[] {
  if (segments.length === 0) return []

  const chunks: Chunk[] = []
  let currentSegments: TranscriptSegment[] = []

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    currentSegments.push(segment)

    const atTarget = currentSegments.length >= targetSize
    const atMax = currentSegments.length >= MAX_CHUNK_SIZE
    const endsWithSentence = SENTENCE_ENDINGS.test(segment.text)
    const isLast = i === segments.length - 1

    // Flush the chunk when:
    // 1. We hit max size (always flush)
    // 2. We're at/past target size AND at a sentence boundary
    // 3. It's the last segment
    const shouldFlush = atMax || (atTarget && endsWithSentence) || isLast

    if (shouldFlush) {
      chunks.push(buildChunk(chunks.length, currentSegments))
      currentSegments = []
    }
  }

  return chunks
}

function buildChunk(index: number, segments: TranscriptSegment[]): Chunk {
  return {
    index,
    segments,
    startTime: segments[0]!.start,
    endTime: segments[segments.length - 1]!.end,
    sourceText: segments.map((s) => s.text).join(" "),
  }
}
