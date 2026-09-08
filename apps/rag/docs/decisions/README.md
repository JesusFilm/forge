# Forge RAG decision records

These ADRs retain the rationale that still governs code migrated from
`JesusFilm/jesusfilm-rag`. They are copied as historical decision records so
the many `ADR-NNNN` references in Forge code and tests resolve locally.

The recovered baseline is standalone commit
`b22a8884f2e822ead54b5bf44d55d93f4c4b5057`. Migration notes and status labels
added here distinguish historical rationale from Forge's current mechanism;
they do not rewrite the decision that was made at the recorded date.

Forge's current implementation and package guidance take precedence where a
mechanism changed during migration. An ADR marked **Forge-superseded** remains
useful provenance but is not an instruction to restore the old mechanism.

| ADR                                                             | Decision                                       | Forge status                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [0001](./0001-ports-and-adapters-boundary.md)                   | Ports-and-adapters boundary                    | Accepted; Forge calls ingestion “indexing” and uses script entry points around shared wiring     |
| [0002](./0002-embeddings-halfvec-1536.md)                       | Original embedding model and 1536-wide storage | Storage retained; model superseded by 0005                                                       |
| [0003](./0003-data-access-drizzle-query-builder.md)             | Drizzle persistence mechanism                  | **Forge-superseded by Prisma plus bounded raw SQL**                                              |
| [0004](./0004-rag-access-http-prod.md)                          | Scoped read-only production HTTP access        | **Forge-amended: `/v1` remains public while Forge consumers may use Railway private networking** |
| [0005](./0005-embedding-model-qwen3-8b-multilingual.md)         | Multilingual Qwen embedding model              | Model accepted; provider routing refined by 0015                                                 |
| [0006](./0006-per-document-language-detection.md)               | Sources by domain; language per document       | Accepted; fallback clause superseded by 0007                                                     |
| [0007](./0007-language-decision-thresholds-null-policy.md)      | Language thresholds and null policy            | Accepted                                                                                         |
| [0008](./0008-language-label-lifecycle.md)                      | Preserve established labels                    | Accepted                                                                                         |
| [0009](./0009-llm-language-detection-sweep.md)                  | Corrective LLM language sweep                  | Accepted                                                                                         |
| [0010](./0010-detector-scores-body-over-chrome.md)              | Score body content rather than chrome          | Accepted                                                                                         |
| [0011](./0011-retrieval-full-document.md)                       | Optional full-document retrieval               | Accepted                                                                                         |
| [0012](./0012-firecrawl-fetch-strategy-walled-sources.md)       | Static per-source Firecrawl transport          | Accepted                                                                                         |
| [0013](./0013-language-sweep-operational-policy.md)             | On-demand language sweep policy                | Accepted                                                                                         |
| [0014](./0014-bulk-copy-raw-documents-to-prod.md)               | Source-scoped raw promotion                    | Decision retained; shell mechanism superseded by Forge `raws:promote`                            |
| [0015](./0015-embedding-gateway-primary-openrouter-fallback.md) | Embedding gateway/fallback policy              | Accepted subject to current environment contracts                                                |
| [0017](./0017-bounded-concurrent-ingestion.md)                  | Bounded concurrent ingestion                   | Accepted; persistence mechanics use Prisma/raw SQL                                               |

The current architecture of record is [`../architecture.md`](../architecture.md).
Original issue and PR links inside these ADRs remain historical provenance; file
paths in an ADR's original context are historical unless a Forge migration note
identifies their current equivalent.
