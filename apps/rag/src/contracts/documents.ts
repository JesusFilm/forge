/**
 * Document shapes that cross the Acquisition → Indexing → storage seams.
 * Types only — no runtime, no I/O. See docs/architecture.md §2.
 */

/** HTTP-level fetch metadata. `bodyHash` is the re-fetch identity (distinct from a document's contentHash). */
export interface FetchMeta {
  status: number | null
  bodyHash: string // sha256(response body)
  etag: string | null
  lastModified: string | null
  fetchedAt: string // ISO-8601
  notModified: boolean
}

/**
 * Acquisition → Indexing handoff. Fetched + extracted via source selectors,
 * but NOT cleaned, tagged, or chunked. Persisted as a `raw_documents` row.
 */
export interface RawDocument {
  sourceKey: string
  url: string
  canonicalUrl: string // normalizeUrl() — the dedup identity
  title: string | null
  rawContent: string // extracted main text, not cleaned
  fetch: FetchMeta
}

/**
 * An un-ingested `raw_documents` staging row, as Indexing drains it: a
 * RawDocument plus the row id needed to mark it consumed (ingested_at).
 */
export interface PendingRawDocument extends RawDocument {
  id: string
}

/** Cleaned + classified document, ready to chunk. Internal to Indexing. */
export interface NormalizedDocument {
  sourceKey: string
  source: string // bare domain (attribution)
  canonicalUrl: string
  title: string | null
  content: string // cleaned
  language: string | null // ISO 639-1 detected from content; null = not confidently detected (#74)
  category: string
  tags: string[]
  contentHash: string // sha256(`${title}\n\n${content}`) — chunk-dedup gate
  metadata: Record<string, unknown>
}

/** One chunk with its embedding, ready to persist. */
export interface EmbeddedChunk {
  ord: number // position within the document
  text: string
  charStart: number
  charEnd: number
  tokenCount: number
  tags: string[]
  embedding: number[]
  embeddingModel: string
}
