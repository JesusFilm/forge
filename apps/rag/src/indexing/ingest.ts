/**
 * ingest — drain pending raw_documents → corpus, the Indexing orchestrator.
 *
 * Per document: normalize → dedup gate (skip when contentHash is unchanged) →
 * chunk → embed → idempotent `replaceDocument` (delete-then-insert, one tx).
 * upsertSource runs once per source before its first document. Each consumed
 * staging row is marked ingested so a re-run drains only new/changed pages.
 * Bounded concurrency and duplicate-identity ordering are governed by ADR-0017.
 *
 * All I/O is via injected ports (RawDocumentReader, Embedder, CorpusWriteStore);
 * the registry (pure data) supplies each source's crawl/defaults. No adapter is
 * constructed here — the runner (scripts/index.ts) wires them. See architecture §3.
 */
import type {
  CorpusWriteStore,
  Embedder,
  EmbeddedChunk,
  PendingRawDocument,
  RawDocumentReader,
  SourceRecord,
} from "../contracts/index.js"
import { getSource, type SourceEntry } from "../registry/index.js"
import { normalizeDocument } from "./normalize.js"
import { chunkDocument } from "./chunk.js"

const MAX_INGEST_CONCURRENCY = 4

export interface IngestDeps {
  reader: RawDocumentReader
  embedder: Embedder
  writer: CorpusWriteStore
}

export type IngestStatus =
  | "inserted"
  | "updated"
  | "unchanged"
  | "skipped-thin"
  | "skipped-no-chunks"

export interface IngestSummary {
  attempted: number
  inserted: number
  updated: number
  unchanged: number
  skipped: number
  unknownSource: number
  chunksWritten: number
}

export interface IngestOptions {
  sourceKey?: string
  limit?: number
  /** Maximum distinct documents processed at once. Default 1 preserves legacy behavior. */
  concurrency?: number
  /**
   * Re-index from the raw snapshot: re-drain already-ingested rows AND re-embed
   * a document whose content is unchanged **when it isn't already on the target
   * embedding model**. A document already on the target model is skipped, so an
   * interrupted `force` re-embed RESUMES on a plain re-run — it does the
   * remaining old-model docs instead of restarting the whole source (the #39
   * re-embed / model-migration path). Default false = incremental (only
   * un-ingested rows, skip unchanged).
   */
  force?: boolean
  /**
   * Unconditional re-embed: like `force`, but re-embed EVERY document even one
   * already on the target model (bypasses the model-aware skip). The escape
   * hatch for a change that alters chunk output without changing the model —
   * e.g. a chunker retune. Implies `force`. Rarely needed; `force` is the
   * resumable default for model swaps.
   */
  forceAll?: boolean
  onProgress?: (line: string) => void
}

interface IngestResult {
  status: IngestStatus
  chunks: number
  warning?: string
}

function sourceRecordOf(entry: SourceEntry): SourceRecord {
  return {
    key: entry.key,
    name: entry.name,
    domain: entry.domain,
    trust: entry.trust,
    ingestionMode: entry.ingestionMode,
    languages: entry.languages,
    defaultTags: entry.defaultTags,
    defaultCategory: entry.defaultCategory,
    rights: entry.rights,
    contentHash: null, // source-level reindex gate unused in v1 (per-doc dedup carries it)
  }
}

/** Normalize → dedup → chunk → embed → write one staging row. */
async function ingestDocument(
  deps: IngestDeps,
  entry: SourceEntry,
  raw: PendingRawDocument,
  flags: { force: boolean; forceAll: boolean },
): Promise<IngestResult> {
  const norm = normalizeDocument(entry, {
    url: raw.url,
    canonicalUrl: raw.canonicalUrl,
    title: raw.title,
    rawContent: raw.rawContent,
  })
  if (!norm.ok) return { status: "skipped-thin", chunks: 0 }
  const doc = norm.doc
  // Language decision warning (detected outside the declared set, #74) — an
  // operator signal independent of whether this row's write is deduped away.
  const warning = norm.warning

  const existing = await deps.writer.getDedup(doc.sourceKey, doc.canonicalUrl)
  if (existing && existing.contentHash === doc.contentHash) {
    // Content unchanged. Re-embedding is worthwhile only when the stored vectors
    // are stale, so skip unless we must re-embed:
    //  - forceAll re-embeds unconditionally (chunker-change escape hatch); or
    //  - force re-embeds a document on a DIFFERENT model than the target — the
    //    resumable re-embed (already-migrated docs skipped, the rest re-run).
    // A plain (non-force) run always skips unchanged content (incremental dedup).
    const onTargetModel = existing.embeddingModel === deps.embedder.model
    const mustReembed = flags.forceAll || (flags.force && !onTargetModel)
    if (!mustReembed) return { status: "unchanged", chunks: 0, warning }
  }

  const spans = chunkDocument(doc.content)
  const embeddings = await deps.embedder.embed(spans.map((s) => s.text))
  const chunks: EmbeddedChunk[] = []
  spans.forEach((s, i) => {
    const embedding = embeddings[i]
    if (!embedding) return // null = skip (blank/failed embedding)
    chunks.push({
      ord: chunks.length, // contiguous after any skips
      text: s.text,
      charStart: s.charStart,
      charEnd: s.charEnd,
      tokenCount: s.tokenCount,
      tags: doc.tags,
      embedding,
      embeddingModel: deps.embedder.model,
    })
  })
  if (chunks.length === 0)
    return { status: "skipped-no-chunks", chunks: 0, warning }

  await deps.writer.replaceDocument(doc, chunks)
  return {
    status: existing ? "updated" : "inserted",
    chunks: chunks.length,
    warning,
  }
}

/** Fold one completed row into the shared summary and operator progress stream. */
function recordResult(
  summary: IngestSummary,
  raw: PendingRawDocument,
  result: IngestResult,
  onProgress?: (line: string) => void,
): void {
  if (result.status === "inserted") summary.inserted++
  else if (result.status === "updated") summary.updated++
  else if (result.status === "unchanged") summary.unchanged++
  else summary.skipped++
  summary.chunksWritten += result.chunks
  if (result.warning) onProgress?.(`  ⚠ ${raw.url} — ${result.warning}`)
  onProgress?.(`  ✓ ${raw.url} — ${result.status} (${result.chunks} chunks)`)
}

/** Enforce the operational cap at the context boundary, not only in CLI parsing. */
function validateConcurrency(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_INGEST_CONCURRENCY
  ) {
    throw new Error(
      `ingestPending: concurrency must be a safe integer from 1 to ` +
        `${MAX_INGEST_CONCURRENCY}, got ${value}`,
    )
  }
}

/** Drain all pending staging rows (optionally scoped) through ingestDocument. */
export async function ingestPending(
  deps: IngestDeps,
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const forceAll = opts.forceAll ?? false
  const force = (opts.force ?? false) || forceAll // forceAll implies force
  const pending = await deps.reader.listPending({
    sourceKey: opts.sourceKey,
    limit: opts.limit,
    includeIngested: force, // force/forceAll ⇒ re-index from the snapshot
  })
  const summary: IngestSummary = {
    attempted: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    unknownSource: 0,
    chunksWritten: 0,
  }
  const concurrency = opts.concurrency ?? 1
  validateConcurrency(concurrency)

  // Resolve registry entries and group duplicate corpus identities before any
  // concurrent work. raw_documents deliberately has no canonical-url unique
  // constraint; rows targeting the same corpus document must retain input order
  // or concurrent replace transactions could make the final version timing-dependent.
  const jobs = new Map<
    string,
    { entry: SourceEntry; raws: PendingRawDocument[] }
  >()
  const entries = new Map<string, SourceEntry>()
  for (const raw of pending) {
    const entry = getSource(raw.sourceKey)
    if (!entry) {
      // Leave the row un-marked: a later registry fix can pick it up.
      summary.attempted++
      summary.unknownSource++
      opts.onProgress?.(`  ⤫ ${raw.url} — unknown source '${raw.sourceKey}'`)
      continue
    }
    entries.set(entry.key, entry)
    const key = `${entry.key}\0${raw.canonicalUrl}`
    const job = jobs.get(key)
    if (job) job.raws.push(raw)
    else jobs.set(key, { entry, raws: [raw] })
  }

  // Establish every source before releasing document workers. This preserves
  // the old upsert-once-before-first-document invariant without a check/set race.
  for (const entry of entries.values()) {
    await deps.writer.upsertSource(sourceRecordOf(entry))
  }

  const queue = [...jobs.values()]
  let next = 0
  let failed = false
  let firstError: unknown
  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = next++
      if (index >= queue.length) return
      const { entry, raws } = queue[index]
      try {
        // Duplicate canonical identities remain sequential inside one job.
        for (const raw of raws) {
          summary.attempted++
          const result = await ingestDocument(deps, entry, raw, {
            force,
            forceAll,
          })
          await deps.reader.markIngested([raw.id])
          recordResult(summary, raw, result, opts.onProgress)
        }
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  )
  if (failed) throw firstError

  return summary
}
