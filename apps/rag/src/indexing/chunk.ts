/**
 * chunk — split cleaned text into ~500-token chunks with 50-token overlap,
 * preserving paragraph boundaries, dropping tail chunks < 20 tokens
 * (architecture §2 invariant 4). The chunking algorithm is ported verbatim from
 * jesusfilm-ai's `chunk.ts` — its behaviour is the contract; only the typing and
 * the per-chunk span/token bookkeeping (for the NOT NULL chunk columns) are new.
 *
 * char_start/char_end are best-effort source offsets located by matching each
 * chunk's text against a whitespace-collapsed projection of the content; they
 * are metadata only (retrieval ranks on the embedding, never on offsets) and may
 * be approximate where overlap/whitespace-normalisation prevents an exact match.
 */

/** Rough token count (1 token ≈ 4 chars for English) — jfa's estimator. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function overlapText(text: string, overlapChars: number): string {
  const trimmed = text.trim()
  if (!trimmed) return ""
  const words = trimmed.split(/\s+/)
  if (words.length > 1) {
    return words.slice(-Math.ceil(overlapChars / 5)).join(" ")
  }
  return trimmed.slice(-overlapChars)
}

function splitOversizedText(text: string, maxChars: number): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars)
    if (cut < Math.floor(maxChars * 0.6)) cut = maxChars
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts.filter(Boolean)
}

function splitParagraph(para: string, maxChars: number): string[] {
  if (para.length <= maxChars) return [para]
  const sentences = para.match(
    /[^.!?。！？]+[.!?。！？]+["')\]]*\s*|[^.!?。！？]+$/g,
  ) ?? [para]
  return sentences.flatMap((sentence) => splitOversizedText(sentence, maxChars))
}

export interface ChunkOptions {
  maxTokens?: number
  overlapTokens?: number
}

/** Split text into overlapping, paragraph-preserving chunks. Ported from jfa. */
export function chunkText(
  text: string,
  { maxTokens = 500, overlapTokens = 50 }: ChunkOptions = {},
): string[] {
  if (!text || !text.trim()) return []

  const maxChars = maxTokens * 4
  const overlapChars = overlapTokens * 4
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return []

  const chunks: string[] = []
  let currentChunk = ""

  function flush(): void {
    if (!currentChunk.trim()) return
    const flushed = currentChunk.trim()
    chunks.push(flushed)
    currentChunk = overlapText(flushed, overlapChars)
  }

  function appendPart(part: string, separator: string): void {
    const piece = part.trim()
    if (!piece) return
    const sep = currentChunk ? separator : ""
    if (
      currentChunk &&
      currentChunk.length + sep.length + piece.length > maxChars
    ) {
      flush()
      if (
        currentChunk &&
        currentChunk.length + separator.length + piece.length > maxChars
      ) {
        currentChunk = ""
      }
    }
    currentChunk += (currentChunk ? separator : "") + piece
  }

  for (const para of paragraphs) {
    const parts = splitParagraph(para, maxChars)
    const separator = parts.length === 1 ? "\n\n" : " "
    for (const part of parts) appendPart(part, separator)
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim())

  return chunks.filter((c) => estimateTokens(c) >= 20)
}

export interface ChunkSpan {
  ord: number
  text: string
  charStart: number
  charEnd: number
  tokenCount: number
}

const PROBE_LEN = 60

/** Whitespace-collapsed projection of `content` with a back-map to source indices. */
function project(content: string): { text: string; map: number[] } {
  let text = ""
  const map: number[] = []
  let prevSpace = false
  for (let i = 0; i < content.length; i++) {
    if (/\s/.test(content[i])) {
      prevSpace = true
      continue
    }
    if (prevSpace && text.length > 0) {
      text += " "
      map.push(i)
    }
    text += content[i]
    map.push(i)
    prevSpace = false
  }
  return { text, map }
}

/**
 * Chunk `content` and attach each chunk's source span + token count. Spans are
 * located forward in the projection (chunks are produced in document order, so a
 * forward scan resolves the overlapping boundaries); an unlocatable chunk falls
 * back to a sequential span after the previous one.
 */
export function chunkDocument(content: string): ChunkSpan[] {
  const texts = chunkText(content)
  const { text: proj, map } = project(content)
  const spans: ChunkSpan[] = []
  let projFrom = 0

  texts.forEach((chunk, ord) => {
    const needle = chunk.replace(/\s+/g, " ").trim()
    const probe = needle.slice(0, PROBE_LEN)
    let at = proj.indexOf(probe, projFrom)
    if (at < 0) at = proj.indexOf(probe)

    let charStart: number
    let charEnd: number
    if (at >= 0) {
      charStart = map[at] ?? 0
      const endIdx = Math.min(proj.length - 1, at + needle.length - 1)
      charEnd = (map[endIdx] ?? content.length - 1) + 1
      projFrom = at + 1
    } else {
      charStart = spans.length ? spans[spans.length - 1].charEnd : 0
      charEnd = Math.min(content.length, charStart + chunk.length)
    }

    spans.push({
      ord,
      text: chunk,
      charStart,
      charEnd,
      tokenCount: estimateTokens(chunk),
    })
  })

  return spans
}
