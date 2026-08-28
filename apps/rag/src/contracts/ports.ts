/**
 * The ports each context depends on. Concrete implementations live in
 * src/adapters and are wired in src/main.ts — never imported by a context.
 * Types only. See docs/architecture.md §4.
 */
import type {
  RawDocument,
  PendingRawDocument,
  NormalizedDocument,
  EmbeddedChunk,
} from "./documents.js"
import type { SourceRecord } from "./sources.js"
import type { ScoredRow, SearchFilter } from "./retrieval.js"

// ---- Acquisition ports -----------------------------------------------------

export interface ConditionalHeaders {
  ifNoneMatch?: string
  ifModifiedSince?: string
}

export interface FetchResult {
  status: number | null
  body: string | null // null on 304 / not-modified
  etag: string | null
  lastModified: string | null
  notModified: boolean
}

export interface Fetcher {
  fetch(url: string, conditional?: ConditionalHeaders): Promise<FetchResult>
}

export interface HttpCacheEntry {
  url: string
  etag: string | null
  lastModified: string | null
  bodyHash: string
  status: number | null
  fetchedAt: string
}

export interface RobotsEntry {
  robotsUrl: string
  body: string | null
  status: number | null
  fetchedAt: string
}

export interface FetchStateStore {
  getHttpCache(url: string): Promise<HttpCacheEntry | null>
  putHttpCache(entry: HttpCacheEntry): Promise<void>
  getRobots(robotsUrl: string): Promise<RobotsEntry | null>
  putRobots(entry: RobotsEntry): Promise<void>
}

export interface RawDocumentStore {
  /**
   * Persist one acquired RawDocument to the `raw_documents` staging table.
   * Idempotent per (sourceKey, canonicalUrl): replaces any not-yet-ingested row
   * for the same identity, so re-acquiring a page never accumulates duplicate
   * un-ingested rows. Already-ingested rows are left intact as the raw snapshot.
   */
  putRawDocument(doc: RawDocument): Promise<void>
  /**
   * Every `canonical_url` already staged for a source — ingested OR pending.
   * The resume skip-set: a `--resume` crawl drops these from its fetch list so a
   * paused-and-restarted (or English-already-acquired) crawl re-fetches nothing
   * it already has. Acquisition's read-back view of its own staging progress
   * (the write side is putRawDocument); not the Indexing drain (RawDocumentReader).
   */
  listStagedCanonicalUrls(sourceKey: string): Promise<string[]>
}

// ---- Indexing ports -------------------------------------------------------

export interface RawDocumentReader {
  /**
   * Staging rows to ingest, oldest first. By default only un-ingested rows
   * (`ingested_at IS NULL`); `includeIngested` returns already-consumed rows too
   * (a full re-index from the raw snapshot, e.g. after an embedding-model change).
   * Optional source/limit scope. The read side of the Acquisition→Indexing
   * handoff — the write side is RawDocumentStore.
   */
  listPending(opts?: {
    sourceKey?: string
    limit?: number
    includeIngested?: boolean
  }): Promise<PendingRawDocument[]>
  /** Mark these `raw_documents` rows consumed (set `ingested_at`). */
  markIngested(ids: string[]): Promise<void>
}

export interface Embedder {
  /**
   * Batch embed, index-aligned with `texts`. Returns null for an empty/blank
   * input — the dedup/skip path relies on this. A genuine embedding failure (API
   * error, count/width mismatch) THROWS rather than returning null, so a chunk is
   * never silently dropped; the caller re-runs to resume (ingest marks per-doc).
   */
  embed(texts: string[]): Promise<(number[] | null)[]>
  embedQuery(text: string): Promise<number[]>
  readonly model: string
  readonly dimensions: number
}

/** One document's detected language, from the async `LanguageDetector` port. */
export interface DetectedLanguage {
  /** ISO 639-1 code (`en`, `es`, `fr`, `zh`), or null when genuinely undeterminable. */
  language: string | null
  /** Detector confidence in `[0, 1]`; `0` when it abstains. */
  confidence: number
  /** A short quoted snippet the verdict rests on — for the report + human review. */
  evidence: string
}

export interface LanguageDetector {
  /**
   * Detect the dominant language of one document's CLEANED text — the LLM
   * escalation ADR-0006/0007 reserved behind a port for the corrective sweep,
   * accurate regardless of length (unlike the pure tinyld primitive, which is
   * confidently wrong on short prose). The pure per-doc detector stays in
   * `indexing`; this is the I/O port, constructed only in main.ts.
   *
   * `declared` is the source's declared/expected language set — a hint only;
   * content wins. A hard provider failure THROWS (the sweep marks per-doc and
   * re-runs to resume); `language: null` is a genuine can't-tell, not an error.
   */
  detect(
    text: string,
    opts: { declared: readonly string[] },
  ): Promise<DetectedLanguage>

  /** The detector's model identifier, for logs/reports (e.g. the OpenRouter slug). */
  readonly model: string
}

export interface LlmReviewer {
  /**
   * Free-form LLM pass over an agent-facing summary — used by the language
   * sweep's optional `--llm-review` to sanity-check the proposed relabels (the
   * "an agent processes the work with a quick LLM pass" step). `instruction` is
   * the system prompt; `content` the material to audit; returns the raw text
   * verdict. Constructed only in main.ts.
   */
  review(instruction: string, content: string): Promise<string>
  /** The reviewer's model identifier, for the report header. */
  readonly model: string
}

export interface DedupRecord {
  contentHash: string
  /**
   * The embedding model of this document's stored chunks — any one, since
   * replaceDocument writes a document atomically on a single model, so all its
   * chunks share it. null when the document has no chunks yet (a prior
   * skipped-thin / skipped-no-chunks pass). Lets Indexing skip a `force`
   * re-embed of a document already on the target model, so an interrupted
   * re-embed RESUMES (does the remaining old-model docs) instead of restarting.
   */
  embeddingModel: string | null
}

export interface CorpusWriteStore {
  upsertSource(source: SourceRecord): Promise<string> // returns source id
  /**
   * The document's dedup record (contentHash + current embedding model) for the
   * ingest skip gate, or null when the document isn't in the corpus yet.
   */
  getDedup(sourceKey: string, canonicalUrl: string): Promise<DedupRecord | null>
  /** Delete this document's chunks then insert the new ones, in one transaction. */
  replaceDocument(
    doc: NormalizedDocument,
    chunks: EmbeddedChunk[],
  ): Promise<void>
}

// ---- Retrieval port --------------------------------------------------------

export interface CorpusSearchStore {
  vectorSearch(
    queryVec: number[],
    filter: SearchFilter,
    k: number,
  ): Promise<ScoredRow[]>
  keywordSearch?(
    query: string,
    filter: SearchFilter,
    k: number,
  ): Promise<ScoredRow[]>
  fetchById(chunkId: string): Promise<ScoredRow | null>
  /**
   * Full reassembled text per document id — every chunk of that document
   * concatenated in `ord` order. Retrieval calls this ONLY when a query opts in
   * (`policy.includeDocument`), for the final topK document ids, in ONE batched
   * query. The batching + opt-in are the payload/cost lens (issue #79): a
   * 100-chunk document is ~50k tokens, so the full body is fetched on demand and
   * never on the default path. Returns a Map keyed by document id; an id with no
   * chunks is simply absent (Retrieval falls back to the matched chunk's text).
   * Chunks overlap by ~50 tokens, so the reassembly repeats each boundary once —
   * complete but not deduplicated (char offsets are best-effort; see chunk.ts).
   */
  fetchDocumentTexts(documentIds: string[]): Promise<Map<string, string>>
  /**
   * Distinct `embedding_model` values currently in the corpus. Retrieval uses
   * this to guard against a query/corpus model mismatch — querying a corpus
   * embedded with one model using an embedder configured for another produces
   * silent garbage (different vector spaces). Optional like `keywordSearch`; when
   * a store can't report it, the guard is skipped. During a partial re-embed the
   * set can hold >1 model — the guard only fails if the query model is in NONE.
   */
  embeddingModels?(): Promise<string[]>
}
