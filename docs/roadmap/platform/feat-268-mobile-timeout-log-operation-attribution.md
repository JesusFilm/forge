---
id: "feat-268"
title: "Operation-attributed mobile client-timeout log + Datadog monitor"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "mobile"
  - "observability"
  - "datadog"
---

## Problem

After PR #1616, `graphql.client_timeout_abort` (the Logs warn
`fetchWithTimeout` emits before aborting a request at its 15s budget) is the
PRIMARY client-side signal that admin is hanging for mobile users — the
duplicate RUM "Aborted" errors that previously made timeout storms visible in
Error Tracking are deliberately no longer reported. But the warn logs only
`{ budget_ms }`: an operator cannot tell WHICH GraphQL operation timed out,
and no Logs monitor exists on its rate — during the Jul 15 storm the log
fired 1.42K times and nobody noticed. Both gaps should close before the
production store builds ship (the fleet-search rollout's next step).

## Entry Points — Read These First

1. `apps/mobile/src/lib/apolloClient.ts` — `fetchWithTimeout` (the warn +
   `controller.abort()`); `createRequestChain` shows `datadogLink` merging
   `x-dd-graph-ql-operation-name` into request headers BEFORE HttpLink, so
   the header is present on `init.headers` exactly when Datadog is
   provisioned
2. `apps/mobile/src/lib/datadog.ts` — `datadogGraphqlHeaders` (defines the
   header names via SDK constants), `datadogLog`
3. `apps/mobile/src/lib/apolloClient.test.ts` — existing
   "fetchWithTimeout (client-timeout-abort marker, R12)" describe block to
   extend
4. `docs/solutions/integration-issues/datadog-rum-apollo-abort-error-double-reporting.md`
   — Open Follow-ups section is this ticket's origin

## Grep These

- `graphql.client_timeout_abort` — the warn site + its tests
- `DATADOG_GRAPH_QL_OPERATION_NAME_HEADER` — the header constant to read back
- `budget_ms` — current warn context shape

## What To Build

1. In `fetchWithTimeout`'s timeout callback, read the operation name from
   `init?.headers` (handle both plain-object and `Headers`-instance shapes;
   the key is the SDK's `DATADOG_GRAPH_QL_OPERATION_NAME_HEADER`) and include
   it in the warn context: `{ budget_ms, operation }`, falling back to
   `"anonymous"` when absent (unprovisioned builds skip the attribution link,
   so the header may legitimately be missing).
2. Operator step (document in the PR body, execute in Datadog): a Logs
   monitor on the rate of `service:forge-mobile "graphql.client_timeout_abort"`
   (suggested start: warn at >30/15min per env, alert at >100/15min — the
   Jul 15 storm ran ~90/15min sustained; calibrate against a quiet week).

## Constraints

- The operation name is the only new field — never log URLs, variables, or
  header values beyond the op name (a bounded, non-PII operation identifier
  by construction; same posture as the RUM op-name attribution).
- Do not move the warn after `controller.abort()` — the marker must fire
  even if abort throws, and the current order is load-bearing for tests.
- The header read must not throw on exotic `init.headers` shapes — wrap
  defensively; a failed read degrades to `"anonymous"`, never a crash in the
  timeout path (telemetry must never break the app).
- Per the mocked-shape META law: one test must pass ONLY via the
  Headers-instance branch and one ONLY via the plain-object branch.

## Verification

- `cd apps/mobile && npx jest src/lib/apolloClient.test.ts` — extended tests:
  warn context carries `operation` from a plain-object header; from a
  `Headers` instance; falls back to `"anonymous"` with no headers; existing
  no-marker-on-fast-settle test still green.
- `npx jest && npx tsc --noEmit` — full suite green.
- Datadog side: after a dev-client session with Wi-Fi killed mid-query,
  Logs explorer shows `graphql.client_timeout_abort` entries carrying
  `operation`; the monitor exists and its query returns the same entries.
