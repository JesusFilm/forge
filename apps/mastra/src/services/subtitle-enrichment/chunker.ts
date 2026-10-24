import type { Chunk, TranscriptSegment } from "./types"

const SENTENCE_ENDINGS = /[.!?。！？…]+\s*$/
const DEFAULT_TARGET_SIZE = 4
const MAX_CHUNK_SIZE = 6

export function chunkSegments(
  segments: TranscriptSegment[],
  targetSize: number = DEFAULT_TARGET_SIZE,
): Chunk[] {
  if (segments.length === 0) return []

  const chunks: Chunk[] = []
  let currentSegments: TranscriptSegment[] = []

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    currentSegments.push(segment)

    const atTarget = currentSegments.length >= targetSize
    const atMax = currentSegments.length >= MAX_CHUNK_SIZE
    const endsWithSentence = SENTENCE_ENDINGS.test(segment.text)
    const isLast = index === segments.length - 1

    if (atMax || (atTarget && endsWithSentence) || isLast) {
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
    sourceText: segments.map((segment) => segment.text).join(" "),
  }
}
