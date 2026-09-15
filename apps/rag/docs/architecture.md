# Forge RAG architecture

This is the architecture of record for `apps/rag`. It preserves the behavioral
contracts migrated from `JesusFilm/jesusfilm-rag` while applying Forge's
Prisma, target-profile, typed-error, and deployment conventions. Historical
decision rationale is indexed in [`decisions/README.md`](./decisions/README.md).

## 1. Ownership and boundary

RAG is a separate bounded context, Railway service, and Postgres database. It
owns acquisition, raw staging, indexing, embeddings, retrieval, and its `/v1`
HTTP surface. Consumers own query intent, audience policy, generation, tone,
and answer presentation.

The package import law is enforced by dependency-cruiser:

- domain modules depend on contracts, not concrete adapters;
- adapters implement contract ports;
- composition roots and scripts select adapters and environment targets;
- consumer-neutral HTTP contracts live in `packages/rag-contracts`;
- no app context imports another app context.

Only indexing writes normalized corpus rows. Retrieval and serving are
read-only.

## 2. Stable data contracts and invariants

The durable flow is:

```text
source registry -> acquire -> raw_documents -> index -> documents/chunks/vectors
                                                    -> retrieve -> /v1
```

The following invariants are load-bearing:

1. A source key describes one acquisition boundary, normally one domain.
2. Canonical URL plus source identity determines a document identity.
3. Acquisition stores extracted raw snapshots but never normalizes, chunks, or
   embeds them.
4. Indexing is the only owner of normalized documents, chunks, and embeddings;
   replacement of one document and its chunks/vectors is atomic.
5. Retrieval deduplicates candidates on content hash, canonical URL plus chunk
   ordinal, and normalized title plus text, yielding at most one winning chunk
   per distinct document.
6. Document language comes from cleaned content, not a URL, source default, or
   HTML declaration. Below the accepted evidence thresholds, language is
   `null` rather than guessed.
7. Document and query vectors must use the same configured model and width.
8. Retrieval may optionally reassemble a full document without changing the
   matched chunk used for ranking.
9. Raw and corpus promotion preserve source identity and content digests; they
   never copy secrets or silently select a production target.

Contract types live in `src/contracts`. Schema and persistence details remain
adapter concerns.

## 3. Bounded contexts

### Acquisition

`src/acquisition` discovers allowed URLs, fetches through the configured
transport, extracts the registry-declared content region, canonicalizes the
URL, and stages a raw document. Registry policy owns hosts, paths, crawl limits,
selectors, and the optional Firecrawl transport.

Redirect and sitemap destinations must remain inside source policy. Network
adapters reject private-address destinations. Firecrawl is selected statically
for a source; it is not a runtime fallback from plain HTTP.

### Indexing

`src/indexing` consumes pending raw rows, cleans text, decides language, chunks,
embeds, replaces the document atomically, and records indexing state. Work is
source-scoped and bounded. Concurrent ingestion stops scheduling new work after
the first failure and drains already-running work.

An established non-null language survives a later inconclusive detection. The
on-demand language sweep is a corrective operation and defaults to blank labels;
whole-corpus re-audit is explicit.

### Retrieval

`src/retrieval` embeds the query, asks the corpus-search port for vector-ranked
candidates, applies score and source/language constraints, deduplicates results,
and optionally obtains full document text for final hits. The corpus-search
port retains a lexical-search capability for adapters and future composition,
but the current retriever does not fuse lexical and vector result sets. It does
not generate answers or choose consumer policy.

## 4. Ports and adapters

`src/contracts/ports.ts` is the dependency-inversion seam. Important port
families cover raw staging, indexing persistence, corpus search, embedding,
language detection, and external fetches.

Production adapters live under `src/adapters`; deterministic in-memory
implementations live under `src/fakes`. Core tests use fakes. Adapter integration
tests use a disposable Postgres database. The Prisma schema is the Forge schema
authority; raw SQL remains appropriate for pgvector, full-text ranking, and
bulk operations Prisma cannot express safely.

`src/main.ts` is the shared wiring factory; executable scripts are the outer
composition roots that choose a source or operation. A write-capable script
must resolve its target and apply the matching safety contract before mutation.
Production reads use an explicit target profile; ordinary local reads and writes
use the package-local environment contract.

## 5. Runtime composition and testing

The HTTP composition root wires read-only retrieval and authentication. The
maintenance scripts wire write-capable adapters separately, so an HTTP request
cannot acquire or index content.

Testing layers are intentionally different:

- pure/domain behavior uses fakes and no network;
- adapter behavior uses disposable database integration tests;
- schema drift checks compare Prisma and migration authority;
- status and dashboard checks validate deterministic lifecycle artifacts;
- production receipts record redacted facts only and never substitute a
  procedure for an observed result.

## 6. Source lifecycle

The source registry is executable policy. [`source-status.yaml`](./source-status.yaml)
is the machine-updated lifecycle ledger, [`source-map.yaml`](./source-map.yaml)
is the reconciled planning view, and [`slices/`](./slices/) contains the durable
investigation and resume records referenced by those ledgers.

One domain is normally one source even when it is a translated sibling of
another domain. A multilingual domain remains one source and assigns language
per document. Large related families may be processed in explicit bounded
batches while retaining one source key per domain.

Status commands must fail when a referenced lifecycle file does not exist. A
feature is not complete merely because a metadata field contains a plausible
path.

## 7. Environments and deployment

Target profiles distinguish local writes, production reads, and production
writes. Production writes require the command-specific acknowledgements and
bounds documented in `docs/ops`. Secrets come from the environment and are
never printed or committed.

Deployments use the normal Forge PR-to-main Railway flow. Local worktree code is
never pushed directly to a Railway service. Corpus migration and source-scoped
raw promotion are operator commands, not deployment hooks.

## 8. Decision provenance

The standalone repository at commit
`b22a8884f2e822ead54b5bf44d55d93f4c4b5057` remains the historical provenance
for the recovered ADR set. Forge retains the decisions still governing behavior
and records explicit supersession where its implementation differs. See
[`decisions/README.md`](./decisions/README.md) for the decision-by-decision map.
