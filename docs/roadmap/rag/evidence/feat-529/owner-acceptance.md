# Consumer programme closure — owner acceptance, 2026-09-30

Jaco accepted feat-527, feat-529 and feat-530 as complete after another
production pass through consumer registration and usage. This is an owner
observation and scope decision, not a claim that every original acceptance test
or migration operation was executed. It does not authorize a production change.

## Confirmed by the owner

- `ragbot` and `website-factory` were both created through the RAG consumer
  portal UI. Their one-time keys were saved in Bitwarden; no key is in this
  record.
- Usage showed both consumers with request counts increasing at different
  intervals. The shared screenshot showed `ragbot` at 5 requests / 5 successful
  and `website-factory` at 3 requests / 2 successful in the selected UTC range.
- The owner checked each consumer's report detail.
- A request with a revoked key was rejected with HTTP 401 Unauthorized.
- The owner confirmed the second-user report visibility and owner-restricted
  management checks discussed in the closure review.

## Accepted limits

- No controlled +3 then +2 request sequence or exact `forge-rag-retrieve` task
  path/revision was recorded for this closure. The screenshot and observations
  establish active, separate consumer reporting; they do not attribute each
  request to a particular task version.
- No production inventory or fully covered minute is required. The owner
  removed that reporting design in [PR #2472](https://github.com/JesusFilm/forge/pull/2472).
- The remaining live GitHub outage, stale allowlist publication, removal after
  merge, session restart/replay, and full network/log leakage checks were not
  repeated in production. Earlier local and automated evidence remains linked
  from feat-527 and feat-530.
- The seven-day legacy registration grace and shared-bearer cutoff were not
  performed. The owner accepted the current working multi-consumer service as
  complete without those steps. Legacy access stays in place; any later cutoff
  needs a separately authorized production change.
- Primary/fallback embedding and capacity checks specified for that later
  cutoff were not performed as part of this closure.
