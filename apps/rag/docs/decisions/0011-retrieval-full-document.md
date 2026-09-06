# ADR-0011 — Retrieval can return the full source document per hit

- Status: Accepted
- Date: 2026-07-16
- Issue/PR: [#79](https://github.com/JesusFilm/jesusfilm-rag/issues/79)
- Related: refines invariant 5 (the 3-key dedup / one-chunk-per-document) in [`architecture.md`](../architecture.md) §2; additive to the §3 retrieval contract. No change to ranking, cutoff, dedup, or [ADR-0001](./0001-ports-and-adapters-boundary.md)'s boundaries.

## Context

Invariant 5's 3-key dedup yields **at most one chunk per distinct document**, so the single winning chunk is the entire snippet a consumer sees for that document. cru articles routinely open with a long lead-in anecdote before the substance, so retrieval finds the right document and returns a snippet that answers nothing — a 3-lens judge panel flagged `answer_buried` on **40 of 151 cru documents (26%)** (#79, slice #7 Stage 4). The forcing question: how does a consumer get the buried answer once the right document has been found, without changing which documents rank where?

## Decision

`RankedResult` gains an **optional `document`** field carrying the whole source document, populated **only** when the request sets **`policy.includeDocument: true`**. `text` still holds the matched chunk (the ranking evidence — _why_ the document hit); `document` is the full body to _answer from_.

- The full text is **reassembled in-context** from the winning document's chunks in `ord` order, via a new **`CorpusSearchStore.fetchDocumentTexts(documentIds)`** port method — one batched `document_id IN (...)` query for the final topK only. `ScoredRow` gains `documentId` to key it.
- **Off by default.** The default path is byte-identical to before — no new field, one query, no extra work. The consumer decides when to pay the payload ("mechanism, not policy", §1).
- The contract addition is additive + optional → **same major version**; the OpenAPI artifact is regenerated and the drift test enforces it.

## Alternatives rejected

- **Always return the full document (no flag).** Simplest consumer story, but every response carries full bodies — a 100-chunk document is ~50k tokens, and topK=10 could balloon a response past 100k tokens. Making it opt-in keeps the default cheap and honours mechanism-not-policy: the engine offers the capability, the consumer chooses.
- **Redefine `text` to mean the full document.** Breaking for every consumer relying on `text` being a short matched snippet, and it discards the ranking evidence (which chunk actually matched). Kept `text`, added `document`.
- **Return the matched chunk ± N neighbours (a window).** Bounded payload, but it only fixes "answer adjacent to the anchor" — not #79's actual failure, where the method sits far from the matched anecdote (the Admiral Byrd case). A window would still miss the answer.
- **Store a document-content column and read that.** A schema + write-path change and a second copy of the text. Reassembly from existing `chunks` needs no migration and no new source of truth; `raw_documents` is Acquisition's and off-limits to Retrieval.

## Consequences

- **Makes easy:** a consumer that has the right document can now read its whole body, so a buried answer is recoverable without re-ranking or re-chunking.
- **We live with:** chunks overlap by ~50 tokens, so the reassembled body repeats each chunk boundary once — complete but not deduplicated (char offsets are best-effort; exact de-overlap is deferred as unreliable). The eval suite is doc-level (matches on `docPath`) and so is **blind** to this improvement — it neither degrades nor rewards it; measuring "does the returned payload contain the answer" is a separate, consumer-side concern (#79 follow-up), deliberately not bolted onto the retrieval eval.
- **No server-side payload ceiling (deliberate, revisit if abused):** the opt-in is the only guard — `{ topK: 50, includeDocument: true }` can materialize up to ~50 full documents in one response, and `fetchDocumentTexts` has no `LIMIT`. Acceptable because the surface is a read-only, per-consumer-scoped, authenticated API and the consumer explicitly asks for it. If a client abuses it, add a per-request document-character budget (truncate + flag) — tracked as a follow-up, not built now.
- **`document` is best-effort:** on the rare TOCTOU where a concurrent re-ingest removes a winning document's chunks between ranking and the batch fetch, the field is **omitted** for that hit rather than back-filled with the matched chunk — absence is honest; a chunk mislabeled as the whole document is not.
