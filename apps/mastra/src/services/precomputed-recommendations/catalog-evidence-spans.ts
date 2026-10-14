import { createHash } from "node:crypto"

import { z } from "zod"

import { judgmentSchema, type Chunk } from "./source-generation"

const MAX_SPAN_LENGTH = 240
const MIN_SPAN_LENGTH = 8
const SPAN_OVERLAP = 16
const spanId = z.string().regex(/^[a-f0-9]{32}$/u)

// The provider chooses support, but never authors an excerpt. Metadata evidence
// retains the original schema and the durable Admin payload stays unchanged.
export const spanJudgmentSchema = judgmentSchema.extend({
  connections: z
    .array(
      judgmentSchema.shape.connections.element.extend({
        evidence: z.union([
          z.object({
            basis: z.literal("transcript"),
            spanIds: z.array(spanId).min(1).max(3),
          }),
          judgmentSchema.shape.connections.element.shape.evidence.options[1],
        ]),
      }),
    )
    .max(1),
})

export type SpanContext = {
  generationInputDigest: string
  inputCutoff: string
  sourceVideoId: string
  candidateVideoId: string
  catalogIndex: number
  candidateIndex: number
  afterChunkId: string | null
}

type OfferedSpan = {
  id: string
  start: number
  end: number
  text: string
}

type PromptChunk = Omit<Chunk, "text"> & {
  spans: OfferedSpan[]
  unquotableSegments?: string[]
}

export type TranscriptSpanOffer = {
  promptChunks: PromptChunk[]
  resolve: (id: string) => { chunkId: string; excerpt: string } | undefined
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** Cover every non-whitespace character with exact, bounded visible text.
 * Overlap makes even a short tail selectable without dropping another page. */
export function buildTranscriptSpanOffer(
  chunks: readonly Chunk[],
  context: SpanContext,
): TranscriptSpanOffer {
  const passages = new Map<string, { chunkId: string; excerpt: string }>()
  const promptChunks = chunks.map((chunk): PromptChunk => {
    const spans: OfferedSpan[] = []
    const unquotableSegments: string[] = []
    const chunkBinding = createHash("sha256")
      .update(
        JSON.stringify([
          context,
          chunk.id,
          chunk.transcriptId,
          chunk.language,
          chunk.chunkIndex,
          chunk.text,
        ]),
      )
      .digest("hex")
    for (let start = 0; start < chunk.text.length; ) {
      let end = Math.min(start + MAX_SPAN_LENGTH, chunk.text.length)
      // Slice at JavaScript code-point boundaries so an offered quote never
      // starts or ends halfway through a surrogate pair.
      if (end < chunk.text.length && isLowSurrogate(chunk.text.charCodeAt(end)))
        end -= 1
      const raw = chunk.text.slice(start, end)
      const leading = raw.length - raw.trimStart().length
      const trailing = raw.length - raw.trimEnd().length
      const spanStart = start + leading
      const spanEnd = end - trailing
      const text = chunk.text.slice(spanStart, spanEnd)
      if (text.length >= MIN_SPAN_LENGTH) {
        const id = createHash("sha256")
          .update(JSON.stringify([chunkBinding, spanStart, spanEnd]))
          .digest("hex")
          .slice(0, 32)
        spans.push({ id, start: spanStart, end: spanEnd, text })
        passages.set(id, { chunkId: chunk.id, excerpt: text })
      } else {
        // A complete chunk shorter than the evidence minimum still reaches
        // the model as context. It cannot be cited as invented support.
        unquotableSegments.push(raw)
      }
      if (end === chunk.text.length) break
      start = Math.max(start + 1, end - SPAN_OVERLAP)
      if (isLowSurrogate(chunk.text.charCodeAt(start))) start -= 1
    }
    return {
      id: chunk.id,
      transcriptId: chunk.transcriptId,
      language: chunk.language,
      chunkIndex: chunk.chunkIndex,
      spans,
      ...(unquotableSegments.length > 0 ? { unquotableSegments } : {}),
    }
  })
  return { promptChunks, resolve: (id) => passages.get(id) }
}

export function materializeSpanJudgment(
  output: z.output<typeof spanJudgmentSchema>,
  offer: TranscriptSpanOffer,
): z.output<typeof judgmentSchema> | null {
  const connections = output.connections.map((connection) => {
    if (connection.evidence.basis === "metadata") return connection
    const passages = connection.evidence.spanIds.map(offer.resolve)
    if (passages.some((passage) => !passage)) return null
    return {
      ...connection,
      evidence: {
        basis: "transcript" as const,
        passages,
      },
    }
  })
  if (connections.some((connection) => !connection)) return null
  return judgmentSchema.parse({ connections })
}
