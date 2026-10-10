---
title: "Datadog Error Tracking issue-search client sent no track/include params — a docs-modelled wire contract never observed live"
date: 2026-08-27
category: integration-issues
module: apps/mastra
problem_type: integration_issue
component: service_object
symptoms:
  - "POST /api/v2/error-tracking/issues/search returned HTTP 400 with body text 'either track or persona is required' — every issue search failed as `rejected`, so the sweep's primary source was dead on every enabled hour"
  - "Without the ?include=issue query param, rows parsed clean (unparsedRows=0) while carrying only impacted_sessions/total_count — no error_message, state, or version fields"
  - "The mute filter (R18) and dev-session filter (R17) silently went inert because the fields they read were absent from unincluded rows"
  - "No pagination cursor exists in the real response — meta and links are null and page.limit is not honored (13 rows returned against a limit of 2)"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - datadog
  - error-tracking
  - mastra
  - wire-contract
  - mocked-vs-real
  - pagination
  - linear-triage
---

# Datadog Error Tracking issue-search client sent no track/include params — a docs-modelled wire contract never observed live

## Problem

The Datadog triage pipeline's Error Tracking issue-search client (`apps/mastra/src/services/datadog-triage/datadog-client.ts`, merged flag-off in PR #1968) modelled its wire request and response from Datadog's API documentation, and the pre-merge live check went through the Datadog MCP — a layer that serves its own flattened projection, not the raw HTTP envelope. The first live scoped-key smoke (2026-08-27, runbook step 5) showed the modelled request is rejected outright and the modelled response is missing every detail field that detection depends on.

## Symptoms

- **Every issue search returned HTTP 400** with the body text `"either track or persona is required"`. The client classifies 400 as `rejected`, so the sweep's run report showed the issue source `failed` with reason `rejected` — hourly, forever, once `DATADOG_TRIAGE_ENABLED` flips on. The bug was latent only because the flag is off.
- **With `track` added by hand but no `?include=issue` query parameter**, the response parsed clean (`unparsedRows=0`) while `data[]` rows carried only `impacted_sessions`/`total_count`. Per this session's live probes, `state`, `error_message`, `platform`, and both version fields arrive only in `included[]`, and only when the request carries `?include=issue`. Without them, `isMutedIssue` (`apps/mastra/src/services/datadog-triage/detect.ts:236` — reads `issue.state`) and `isDevShapedIssue` (`detect.ts:209` — reads `firstSeenVersion`/`lastSeenVersion`/`errorMessage`/`filePath`) both go silently inert: muted issues get re-ticketed and dev-session noise passes the release filter, with no signal on any report surface.
- **No pagination cursor exists at either spelling the client accepts**: per the live probe, `meta` and `links` are null and `page.limit` is not honored (13 rows returned against limit 2) — now recorded in the module header (`datadog-client.ts:34-43`) and the cursor schema comment (`datadog-client.ts:211-213`). The full-page-no-cursor guard already reported `truncated` (`datadog-client.ts:456-461`) — fail-safe, no change needed.

## What Didn't Work

- **259 mocked tests stayed green the whole time.** The fixtures encoded the same docs-modelled shape the client did, so they proved branch shape, not the production contract. This is a fresh worked instance of the repo's mocked-shape-vs-real-contract META pattern.
- **Three pre-merge ce-code-review rounds missed it.** Reviewers verify code against fixtures and documentation; none of those artifacts carried the live wire truth, so no reviewer could contradict it.
- **The 2026-08-19 Datadog MCP verification could not catch it.** The MCP flattens rows into its own projection: field NAMES were confirmed real, but the request contract and the `data[]`/`included[]` envelope were structurally invisible through it. The build session recognized this at the time, not later — its own assessment reads: "The raw HTTP envelope is still unverified (the MCP returns its own projection) — that is labelled in the client header and is a named step of the pre-enable smoke." (session history)
- **The build session's "high-fidelity replay" reinforced a false sense of coverage.** It pulled 30 real production `forge-mobile` issues via the MCP, parsed the MCP's output into a fixture, and replayed them through the real detection pipeline against real Postgres — real production error DATA, but never the real production HTTP response SHAPE. The fixture fed the pipeline's internal types directly and never round-tripped through `datadog-client.ts`'s fetch-and-parse, so nothing in that dry run could catch a missing request attribute or query param. (session history)
- **Readiness checks structurally cannot catch this.** `getDatadogTriageReadiness` verifies that credentials are PRESENT — it never makes a live call. The same blind spot had already surfaced once during the build in a different guise (readiness passed with no judgment-model credential); it applies identically to the wire contract. (session history)
- **The pagination cursor-following was reasoned from code, not the wire.** A pre-merge hardening round restructured `searchIssues` to follow the response's cursor, with falsification tests proving the loop discriminates — and the live smoke then found no cursor exists at all. The defensive loop and its `truncated` guard remain correct; the episode shows that even carefully falsified logic exercises a modelled envelope, not the real one. (session history)
- **The first live failure was opaque by design.** The run report deliberately hides raw error text — it records only `unexpected_failure:${errorName}` (`apps/mastra/src/mastra/workflows/datadog-mobile-triage.ts:477`). A local-only tracing Proxy wrapped around the repository/client dependencies named the throwing call; then raw `fetch` matrix probes against the live endpoint varied ONE request attribute at a time (client-exact body -> 400; bare body -> 400; +track -> 200; +include alone -> 400; track+page+include -> 200 with `included[]` detail). That isolation turned one opaque `rejected` into two named missing parameters.

## Solution

Fix opened in PR #2067 (the contract fix plus a review-hardening commit), unmerged as of this writing. CI green; typecheck ran clean locally this session (CI has no standalone tsc job — the build job passing is the closest CI signal).

Before the fix, the request body carried neither parameter:

```ts
body: {
  data: {
    type: "search_request",
    attributes: {
      query: `service:${input.service}`,
      from: input.from.getTime(),
      to: input.to.getTime(),
      ...
```

The pre-fix client already merged `included[]` rows into its projection — but the API never populates `included[]` without the request parameter, so that merge was inert dead weight.

After (`datadog-client.ts:487-506`):

```ts
// `include=issue` is what makes `included[]` carry issue detail; the
// API otherwise returns only ids and counts (verified 2026-08-27).
query: { include: "issue" },
body: {
  data: {
    type: "search_request",
    attributes: {
      query: `service:${input.service}`,
      // Required: the API 400s with "either track or persona is
      // required" when absent (verified 2026-08-27).
      track: input.track,
      ...
```

The pieces:

- A new `DatadogIssueTrack = "rum" | "logs" | "trace"` type (`datadog-client.ts:93`) threads as a required `searchIssues` input (`datadog-client.ts:413-420`).
- The workflow supplies `track: profile.spikeSource` (`datadog-mobile-triage.ts:720-726`); the service-profile schema is `spikeSource: z.enum(["rum", "logs"]).default("logs")` (`apps/mastra/src/config/env.ts:1760`), and the mobile profile sets `rum`.
- The request-shape test pins BOTH parameters — the full URL `...issues/search?include=issue` and the body's `track: "rum"` (`apps/mastra/src/services/datadog-triage/datadog-client.test.ts:353-383`).
- The review-hardening commit added per-profile track assertions in the workflow test (rum vs logs), falsified once by mutation: hardcoding `track: "rum"` made exactly 1 of 41 tests fail. The contract-fix commit had already rewritten the module header (`datadog-client.ts:34-50`) to the verified facts; the review-hardening commit flipped the three REMAINING stale UNVERIFIED comments — the cursor-schema comment (`:211-213`), the `LIVE_ISSUE_ROW` fixture doc-comment (re-labeled synthetic — MCP shape, not the wire), and the "nested under attributes" test comment.

Verification: a live smoke through the fixed client parsed 53 issues over 30 days (0 unparsed, 47 dev-session-excluded, per-source outcomes all `ok`); a full local pipeline exercise judged a real issue with a free OpenRouter model and filed a real Linear ticket (FGE-104), with the live marker-dedup confirmed on re-dispatch. 259 tests green.

## Why This Works

The root cause is that the wire contract was modelled from documentation and then "verified" through a projection layer that hides both the request and the envelope. One gap produced two distinct fail-classes, and they are not equally dangerous:

- **LOUD (missing `track`):** every call 400s. Bad, but self-announcing — the run report shows `rejected` on the first enabled hour, and the operator goes looking.
- **SILENT (missing `include=issue`):** the response is a well-formed page. The parser needs only an issue id and `total_count` to accept a row (`datadog-client.ts:529-537`), so `unparsedRows` stays 0 and nothing looks wrong. But `state` and the version/message fields are `undefined`, and both consuming filters fail toward action: `isMutedIssue` returns false when `state` is undefined, and `isDevShapedIssue` finds no version to test. The pipeline files tickets it should suppress, and no report field distinguishes this from a healthy run. The failure that parses clean is the one that matters.

Threading `track` from the service profile (rather than hardcoding `"rum"`) keeps the parameter correct per service class as backend services join the sweep, and the profile enum's `logs` default matches the API's own telemetry-home semantics.

The same probes also settled two open questions: no extra Error Tracking scope is required (`logs_read_data` + `rum_apps_read` + `monitors_read` suffice), and the raw surface's state vocabulary is OPEN/IGNORED/EXCLUDED — matching `MUTED_ISSUE_STATES` (`detect.ts:38`) — while the MCP spells the same states FOR_REVIEW/REVIEWED. Two vocabularies, one set of states; a client built against the MCP's spelling would have made the mute filter inert a second way.

## Prevention

- **Run the live raw-HTTP smoke the moment any credential exists — and treat it as the contract test, not a formality.** A docs-modelled client is a hypothesis until one real request round-trips. If credentials arrive only at provisioning time, the smoke is the FIRST provisioning step, before any enable flag.
- **Keep a module-header verification ledger, and keep it honest.** The header's explicit "NOT VERIFIED: the raw HTTP envelope" line is what turned this from a production incident into a runbook step. Record what was verified, through WHICH surface, and on what date; flip each line to the verified fact when the evidence lands — a stale UNVERIFIED is noise, and a stale VERIFIED is worse.
- **Never verify a wire contract through a projection layer.** An MCP, an SDK, or a dashboard can confirm field names while hiding the request contract and the envelope shape. Only a raw HTTP request against the live endpoint verifies the wire. A replay harness built from a projection layer's output inherits the same blindness, however much real production data flows through it — coverage of the DATA is not coverage of the SHAPE.
- **Readiness gates verify presence, not contracts.** A readiness check that inspects env vars can never catch a wire mismatch; do not let a green readiness report stand in for the smoke.
- **Diagnose with one-variable matrix probes.** When a leak-safe report gives only an opaque failure class, wrap the dependency seam in a local tracing Proxy to name the throwing call, then vary one request attribute per probe. Each probe's diff names one parameter; a kitchen-sink "fixed" request names none.
- **Pin required parameters positively, and falsify the pin once.** The request-shape test asserts the exact URL (including the query string) and the exact body. The per-profile assertions were checked by mutation — hardcode the value, watch exactly one test fail — so the pin is known non-vacuous.
- **An optional-but-behavior-changing request parameter needs a presence-of-detail assertion, not just a parse-success assertion.** `include=issue` changes WHAT arrives, not WHETHER the response parses. Any test or smoke that would stay green when the parameter is dropped proves nothing about it; assert that the fields the parameter unlocks are actually present.
- **Label synthetic fixtures in place.** The MCP-shaped `LIVE_ISSUE_ROW` read as a production-reachability claim until it was re-labeled synthetic naming its true producer — the standing rule from the repo's synthetic-fixture discipline.
- **Residual risks, with their hardening candidates:**
  - Only `track="rum"` is live-verified. Verify each NEW track value with that service's onboarding smoke before adding it to `DATADOG_TRIAGE_SERVICES`.
  - A `data[]` row with no `included[]` match would still parse clean with `state`/versions undefined — the filters go inert per-row, unobserved but structurally possible. Hardening: a detail-missing counter beside `unparsedRows`, plus a two-rows/one-detail fixture.
  - The 4 MiB `DATADOG_TRIAGE_MAX_RESPONSE_BYTES` default predates two facts from this smoke: `include=issue` roughly doubles rows per response, and `page.limit` is not honored, so the page size is upstream-controlled. Re-derive the cap by measuring a maximal live page, per the repo's measured-not-computed budget law.

## Related Issues

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META home; this doc is a fresh worked instance (docs-modelled wire contract, mock-green, live-red).
- `docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md` — same-app precedent: an optional-but-behavior-changing param (`?label=`) that silently degrades when omitted.
- `docs/solutions/security-issues/invisible-character-class-gap-defeats-url-redaction.md` — same feature area (datadog-triage), different defect; the pipeline's earlier hardening arc.
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md` — the client convention this module follows; the fix rides the existing request-construction path.
- `docs/runbooks/datadog-mobile-triage.md` — the runbook whose step 5 IS the smoke that found this; its "cursor field name is unverified" paragraph is settled by these findings (no cursor exists).
- `docs/roadmap/platform/feat-397-datadog-mobile-triage.md` — "Remaining Operator Work" item 5 (the envelope-shape half is now answered; no extra Error Tracking scope was needed).
