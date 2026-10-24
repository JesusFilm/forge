# Native-language Watch Search qualification

Status: **NOT RUN — NOT QUALIFIED**

No production qualification was run while implementing the tooling. Public
Watch must remain on `WATCH_SEARCH_TYPESENSE_PROFILE=CURRENT`.

| Gate                                                          | Status  |
| ------------------------------------------------------------- | ------- |
| Immutable generation and renewable evaluation lease           | NOT RUN |
| Reviewed `public-watch-absolute/v2` qrels and operator review | NOT RUN |
| Alternating paired p50/p95/p99 and 95% bound                  | NOT RUN |
| Query/byte/work/hydration non-regression                      | NOT RUN |
| Fixed-load Admin and Typesense CPU/RSS/throughput             | NOT RUN |
| Disk, free space, swap, build peak, and vector ownership      | NOT RUN |
| Public current search under maximum comparison load           | NOT RUN |
| Failure isolation and kill-switch exercise                    | NOT RUN |

A future report must identify one application revision, current physical
binding tuple, candidate generation and physical binding tuple, transcript
projection revision, qrel revision, and named reviewer. It must retain every
non-warmup attempt and link the resource and interference artifacts. Any
missing evidence, drift, error, degradation, or threshold breach keeps the
candidate unqualified.

Operational commands and rollback/removal procedures are documented in
`docs/operations/typesense-watch-search-production-readiness.md`.
