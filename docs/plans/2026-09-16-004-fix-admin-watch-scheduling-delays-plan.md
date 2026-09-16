---
title: Investigate and resolve intermittent Admin Watch delays
type: fix
status: active
date: 2026-09-16
---

# Intermittent Admin Watch delays

Origin: `docs/roadmap/platform/feat-496-watch-rollout-runtime-recovery.md` and
`docs/operations/watch-runtime-followup-2026-09-16.md`.

## Scope and decisions

Investigate recommendation delivery fallbacks separately from selection
acknowledgment failures. Attribute elapsed time to database execution, pool/lock
waiting, or application scheduling before choosing a fix. CPU samples alone
do not prove which workload initiates a stall. Selection has no Redis admission.

Keep the authored English homepage block removed and its feature flag default
off. Preserve existing deadlines, identity, authorization, attribution,
transaction integrity and rate limits. No ambiguous mutation retries, hidden
errors, Mobile/TV changes, account linking, or curation publication.

## Work units

1. Verify live Web/Admin/worker revisions using Railway and correlate recent
   Datadog requests. Record HTTP failures and semantic fallbacks independently.
   Inspect `apps/admin/src/db/client.ts`, `apps/admin/src/db/prisma-pool-config.ts`,
   recommendation delivery/evidence services, and workloads observed in captures.
   Use bounded diagnostics with explicit restoration; use only a dedicated local
   database/process for reproduction.
2. Test a hypothesis under the observed workload, measuring before/after against
   the same dataset and concurrency. Choose the smallest demonstrated correction.
   Add colocated behavioral regression coverage for the identified code and a
   reproducible performance check that fails on the old implementation. Resolve
   the exact implementation and test files from the causal evidence, not guesses.
3. Run scoped tests, applicable real-database regressions, Admin types/lint/build,
   formatting and CI checks. Review correctness, reliability, security, performance
   and maintainability sequentially as required by the repository tool mapping.
4. Document cause and limitations under `docs/solutions/`, update feat-496
   honestly, incorporate newer main changes and revalidate before a normal PR
   squash merge. Verify exact automatically deployed revision and observe a fixed
   production window with separate HTTP and semantic outcome populations.

## Execution-time unknowns

- Which concurrent workload, if any, delays application callbacks?
- Are pool acquisition and lock waits material during the same incidents?
- Does the representative reproduction account for both delivery and selection?
- Does any unrelated residual admission failure prevent closing feat-496?

Recovery requires causal reproduction and sustained production evidence. A short
healthy window, successful navigation, or HTTP 200 alone cannot close the ticket.

## Continuation after PR #2319

The 02:15–02:45 UTC window reproduced one upstream selection HTTP 503 and one
HTTP 200 `delivery_timeout` fallback after the duration fix. A matched browser,
CPU and independent PostgreSQL capture showed a selection lookup completing in
2.6 ms, followed by over 250 ms of PostgreSQL `ClientRead` waiting for Admin.
The event loop paused for 139 ms; no database blocker was observed on that trace.

Catalog hydration still expands 100 selected dubs into 3,660 subtitle objects
and a 5.5 MB Prisma result. Pothos defaults to all scalar fields, including unused
subtitle fields and repeated language metadata. A local matching-cardinality
control/treatment preserved the requested response exactly while narrow scalar
selection reduced maximum loop delay from 174 ms to 42 ms. Neither isolated run
exceeded 700 ms, so this reproduces the scheduling component, not the complete
production failure rate. Implement Pothos select mode only for VideoSubtitle and
Language, with explicit selections for custom fields. Verify full GraphQL output,
all requested metadata fields, real database execution and production outcomes.
