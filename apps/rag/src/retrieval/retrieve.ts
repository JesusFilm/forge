/**
 * Retrieval context — query + policy → ranked, cited results. The core library
 * with no transport: embed the query, fan out candidates from the
 * CorpusSearchStore, apply the minScore cutoff, 3-key dedup, then assemble
 * citations. All I/O is via injected ports (Embedder query side,
 * CorpusSearchStore); main.ts wires them — no adapter is constructed here.
 * See docs/architecture.md §3 (Retrieval) and §2 invariant 5.
 */
import type {
  CorpusSearchStore,
  Embedder,
  RankedResult,
  RetrievalPolicy,
  Retriever,
  ScoredRow,
  SearchFilter,
} from "../contracts/index.js"

export interface RetrieveDeps {
  /** Query side only — embedQuery(text). Must match the corpus embedding model. */
  embedder: Embedder
  search: CorpusSearchStore
}

const DEFAULT_TOP_K = 5
const DEFAULT_MIN_SCORE = 0.37 // re-derived from the SWG eval baseline (FOLLOW-UP A).
// Principle: as LOW as possible to admit weak-but-genuine answers across a broad
// topic range, but above the ~0.35 noise floor (off-topic starts scoring there).
// 0.35 is the hard floor we won't drop below; expect to re-derive per slice.

/**
 * Absolute ceiling on the candidate fan-out — bounds the per-query DB work.
 * Generous enough that it is never reached by a realistic consumer topK; it
 * exists to stop a pathological `topK: 100000` from scanning the corpus.
 */
const MAX_CANDIDATES = 500

/**
 * Candidate fan-out before the cutoff (invariant 5): over-fetch so the minScore
 * cutoff + 3-key dedup still leave enough rows to fill topK.
 *
 * The ceiling MUST scale with topK. It was previously a flat 50, which silently
 * capped the fan-out for any topK >= 17: the store returned 50 chunks, the 3-key
 * dedup collapsed them to ~33 distinct documents, and `search` then answered a
 * request for 100 results with 33 — truncating without a word. Retrieval defaults
 * (topK 5 -> 15) and the eval (topK 10 -> 30) sit below the old cap, so they never
 * saw it; deep-k curation probing did. An API that quietly ignores its own topK is
 * a correctness bug, not a tuning knob.
 */
export function candidateTopK(topK: number): number {
  return Math.min(MAX_CANDIDATES, Math.max(topK * 3, topK + 5))
}

/**
 * RetrievalPolicy → the store's candidate SearchFilter. `allowedSourceKeys` is a
 * hard visibility scope; `preferSourceKey` is a soft preference (a tiebreak after
 * ranking, never a filter) so it is deliberately absent here.
 */
export function policyToFilter(policy: RetrievalPolicy): SearchFilter {
  return {
    allowedSourceKeys: policy.allowedSourceKeys,
    language: policy.language,
    category: policy.category,
  }
}

/** Normalized surface fingerprint (title + text) — one of the three dedup keys. */
function fingerprint(title: string | null, text: string): string {
  const t = (title ?? "").trim().toLowerCase()
  const body = text.replace(/\s+/g, " ").trim().toLowerCase()
  return `${t}\u0000${body}`
}

/**
 * 3-key dedup (invariant 5): drop a candidate that collides with an
 * already-kept (higher-scored) result on ANY of — document content-hash,
 * canonicalUrl+ord, or title+text fingerprint. content_hash is document-level
 * (sha256 of `title\n\ncontent`), so this yields at most one chunk per distinct
 * document — diverse sources over many chunks of one article. Input must be
 * score-descending; order is preserved.
 */
function dedup(rows: ScoredRow[]): ScoredRow[] {
  const seenHash = new Set<string>()
  const seenUrlChunk = new Set<string>()
  const seenFingerprint = new Set<string>()
  const kept: ScoredRow[] = []
  for (const row of rows) {
    const urlChunkKey = `${row.canonicalUrl}\u0000${row.ord}`
    const fpKey = fingerprint(row.title, row.text)
    if (
      seenHash.has(row.contentHash) ||
      seenUrlChunk.has(urlChunkKey) ||
      seenFingerprint.has(fpKey)
    ) {
      continue
    }
    seenHash.add(row.contentHash)
    seenUrlChunk.add(urlChunkKey)
    seenFingerprint.add(fpKey)
    kept.push(row)
  }
  return kept
}

/**
 * Soft source preference: a stable re-rank that wins ties only — preferred-source
 * rows move ahead of equally-scored others, score order is otherwise untouched.
 * A real score boost / interleave is deferred until multi-source eval exists.
 */
function applyPreference(
  rows: ScoredRow[],
  preferSourceKey?: string,
): ScoredRow[] {
  if (!preferSourceKey) return rows
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ap = a.sourceKey === preferSourceKey ? 0 : 1
    const bp = b.sourceKey === preferSourceKey ? 0 : 1
    return ap - bp
  })
}

/** ScoredRow → the caller-facing RankedResult (citation = source attribution). */
function toRankedResult(row: ScoredRow): RankedResult {
  return {
    chunkId: row.chunkId,
    score: row.score,
    text: row.text,
    ord: row.ord,
    tags: row.tags,
    citation: {
      sourceKey: row.sourceKey,
      sourceName: row.sourceName,
      title: row.title,
      url: row.canonicalUrl,
    },
  }
}

/**
 * Query/corpus model-match guard: the query embedder's model MUST be one the
 * corpus was embedded with, or query and document vectors live in different
 * spaces and every result is silent garbage (e.g. a qwen corpus queried by a
 * 3-small embedder after a botched cutover). Fails only when the query model is
 * in NONE of the corpus models — so a partial re-embed (mixed models) still
 * serves the rows that match. Skipped when the store can't report models or the
 * corpus is empty. See docs/ops/prod-reembed.md, ADR-0005.
 */
async function assertModelMatch(deps: RetrieveDeps): Promise<void> {
  if (!deps.search.embeddingModels) return // store can't report — skip
  const models = await deps.search.embeddingModels()
  if (models.length === 0) return // empty corpus — nothing to mismatch yet
  if (!models.includes(deps.embedder.model)) {
    throw new Error(
      `retrieval model mismatch: query embedder is "${deps.embedder.model}" but the corpus ` +
        `was embedded with [${models.join(", ")}]. Queries and documents must use the same ` +
        `embedding model or retrieval returns silent garbage — set EMBED_MODEL_ID to match ` +
        `the corpus (see docs/ops/prod-reembed.md).`,
    )
  }
}

/**
 * Build a Retriever over the injected ports. The pipeline order is invariant 5:
 * embedQuery → vectorSearch(candidateTopK) → minScore cutoff → preference →
 * 3-key dedup → slice to topK → cite. The model-match guard runs once (memoized)
 * on the first search; a failure is not cached, so it re-checks and keeps
 * throwing until the misconfiguration is fixed.
 */
export function createRetriever(deps: RetrieveDeps): Retriever {
  let modelGuard: Promise<void> | null = null
  const ensureModelMatch = (): Promise<void> => {
    modelGuard ??= assertModelMatch(deps).catch((err: unknown) => {
      modelGuard = null
      throw err
    })
    return modelGuard
  }
  return {
    async search(
      query: string,
      policy: RetrievalPolicy = {},
    ): Promise<RankedResult[]> {
      await ensureModelMatch()
      const topK = policy.topK ?? DEFAULT_TOP_K
      const minScore = policy.minScore ?? DEFAULT_MIN_SCORE

      const queryVec = await deps.embedder.embedQuery(query)
      const candidates = await deps.search.vectorSearch(
        queryVec,
        policyToFilter(policy),
        candidateTopK(topK),
      )

      const aboveCutoff = candidates.filter((r) => r.score >= minScore)
      const preferred = applyPreference(aboveCutoff, policy.preferSourceKey)
      const winners = dedup(preferred).slice(0, topK)
      const results = winners.map(toRankedResult)

      // Issue #79: on the default path each result is the single matched chunk,
      // so an answer buried past a lead-in anecdote never surfaces. When the
      // consumer opts in, attach the full source document — reassembled from the
      // winning documents' chunks in ONE batched fetch (payload/cost lens: only
      // the final topK, only on request). `text` stays the matched chunk (the
      // ranking evidence); `document` carries the whole body to answer from.
      if (!policy.includeDocument) return results
      const docTexts = await deps.search.fetchDocumentTexts(
        winners.map((r) => r.documentId),
      )
      return results.map((result, i) => {
        const document = docTexts.get(winners[i].documentId)
        // A winning chunk's document always has >= 1 chunk, so the batch
        // resolves it. The lone exception is a TOCTOU: a concurrent re-ingest
        // (replaceDocument deletes-then-inserts in one tx) landing between
        // vectorSearch and this fetch leaves the rows momentarily gone. Omit
        // `document` in that case rather than substituting the matched chunk —
        // absence is honest; a single chunk presented AS the whole document
        // would be indistinguishable from a genuinely one-chunk document.
        return document === undefined ? result : { ...result, document }
      })
    },
  }
}
