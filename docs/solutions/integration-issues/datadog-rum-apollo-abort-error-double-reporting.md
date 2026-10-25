---
title: "Datadog RUM error tracking flooded by double-reported Apollo GraphQL abort errors (mobile)"
date: "2026-07-20"
category: integration-issues
module: apps/mobile
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "854 GraphQL/network errors/week in Datadog RUM Error Tracking for forge-mobile (service forge-mobile), all env:development or env:preview, zero in production"
  - '451 errors with message "cancelled" and 390 with message "Aborted" — the two dominant buckets, both raised when the app''s own 15s fetchWithTimeout budget aborted a request during a stalled-network verification session'
  - 'Each client-initiated abort was reported twice: once by the Datadog RN SDK''s native resource tracking (NSURLErrorDomain -999 "cancelled") and once by Apollo''s ErrorLink (reportGraphqlOperationError), which reported every network-layer error including aborts'
  - '13 "Authentication required" errors (all env:preview, Jul 15) were a separate pre-existing bucket, unrelated to the abort double-reporting and already self-resolved by the mobile fleet search key rollout'
root_cause: logic_error
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  - datadog
  - rum
  - apollo-client
  - graphql
  - error-tracking
  - abort-error
  - react-native
  - observability
---

# Datadog RUM error tracking flooded by double-reported Apollo GraphQL abort errors (mobile)

## Problem

Datadog RUM Error Tracking for `forge-mobile` accumulated 854 errors in one week — every one of them from the team's own dev/preview sessions (zero production), dominated by client-initiated request aborts that were double-reported: once by the SDK's native resource tracking as `-999 "cancelled"`, and again by the app's own Apollo `ErrorLink` as a `SOURCE` error `"Aborted"`. The JS-side half of the double report is the fixable half; PR #1616 (branch `fix/mobile-datadog-abort-noise`, pending merge as of this writing) makes the error link skip client aborts.

## Symptoms

Error Tracking facets over one week (RUM Explorer, grouped by `@error.message`, then × `env` × `version`, then × `@error.resource.url`):

- **`"cancelled"` — 451** (dev 320 / preview 131). Native `NSURLErrorDomain -999` network errors on `https://admin.jesusfilm.org/api/graphql`, auto-reported by the SDK's `trackResources` (`apps/mobile/src/components/DatadogRum.tsx:85`) / `trackErrors` (`apps/mobile/src/components/DatadogRum.tsx:89`). Two strays on Mux stream URLs from player teardown.
- **`"Aborted"` — 390** (dev 261 / preview 129). `ErrorSource.SOURCE` errors emitted by the app's own Apollo error link with custom attrs `{ operation: "GetVideoBySlug", origin: "graphql_network_error" }` (`reportGraphqlOperationError` in `apps/mobile/src/lib/apolloClient.ts`).
- **`"Authentication required"` — 13** (all preview). Pre-existing Search 401s (`CombinedGraphQLErrors`) from before mobile's fleet search key was provisioned/verified 2026-07-16. Self-resolved; no code change needed.
- Zero production errors; volume almost entirely concentrated on Jul 15 — the Datadog-observability verification day, i.e. the team's own stalled-network test scenarios.

The smoking-gun session (found by opening individual error events and reading the parent session's event stream): one 16-minute _idle_ preview session containing 263 events, of which 258 were errors, with **zero user actions** — bursts every 15–22s, each burst = XHR `GetVideoBySlug` → network `-999 "cancelled"` → source `"Aborted"`. Correlating with the Logs explorer: 1.42K `graphql.client_timeout_abort` warns in exactly the same Jul 15 window — the aborts were the app's own 15s `fetchWithTimeout` budget firing (`REQUEST_TIMEOUT_MS = 15_000` at `apps/mobile/src/lib/apolloClient.ts:20`; the timeout marker + `controller.abort()` at `:28-38`).

**The idle-session amplifier (diagnosed, NOT fixed in this PR — open follow-up):** an idle Home screen manufactures requests indefinitely under network failure. The hero pager auto-advances; each slide resolves its stream via `useHeroStream` with `fetchPolicy: "cache-first"` (`apps/mobile/src/hooks/useHeroStream.ts:49`); a failed/aborted query never populates the Apollo cache, and a failed slide is simply skipped — `HeroStreamState.failed`'s own doc comment says "the pager skips the slide" (`useHeroStream.ts:16`) — so rotation degrades into an unbounded, no-backoff retry loop clocked by the 15s timeout. It self-heals on the first success. Affected regimes: stalled/very-slow network (worst — each attempt holds a connection for the full 15s), true offline (fails fast as `TypeError("Network request failed")`, which IS still RUM-reported each cycle), and an admin outage (fleet-wide amplification during incidents).

## What Didn't Work

- **Filtering at the SDK layer.** Only the JS-side `"Aborted"` half is fixable in app code; the native `-999 "cancelled"` stream remains.

  > **Correction (2026-08-06).** The original reasoning here was wrong on two counts, and the wrong version reached `DatadogRum.tsx`'s comment too (both now fixed). First, the JS `errorEventMapper` **is** reachable programmatically — it is declared in `RumConfigurationOptions` and `enableFeatures()` registers it regardless of which config class supplied it; `FileBasedConfiguration` merely has the only _documented_ constructor param. Second, and decisive: it would not have helped anyway. `applyEventMapper` is invoked in exactly one place, inside `DdRum.addError`, so the JS mapper only ever sees JS-origin errors — and these are native.
  >
  > The real seam is one layer down. `dd-sdk-ios`'s native `RUM.Configuration` **does** expose `errorEventMapper`; the React Native bridge simply never sets it (verified absent on both the iOS and Android native init paths, which wire only `resourceEventMapper` and `actionEventMapper`). Reaching it needs a pnpm patch — the pattern this repo already uses against this exact SDK for tvOS.
  >
  > Worth knowing before building any of that: Apple _does_ give a clean cancellation discriminator that the SDK discards. A deliberate `cancel()` drives `URLSessionTask.state` through `.canceling`; a genuine failure never enters that state (measured). `dd-sdk-ios` already implements `task(_:didChangeToState:)` and ignores the signal. Datadog has tracked this as a known gap since 2022 (`dd-sdk-flutter#175`, "Cancelled HTTP requests show as errors in RUM", labelled `pending-native-sdk`). So this is a vendor classification gap, not an Apple platform constraint.

- **The first draft of the guard.** It matched `error.name === "AbortError" || error.message === "Aborted"` and ran BEFORE the `CombinedGraphQLErrors.is(error)` branch. This intermediate only ever existed uncommitted — a 9-reviewer + 2-validator `ce-code-review` pass killed the message disjunct with three source-verified facts:
  1. **The message clause added zero recall.** RN's fetch is a thin shim over whatwg-fetch (`react-native/Libraries/Network/fetch.js` is `require('whatwg-fetch')`), and whatwg-fetch 3.6.20 rejects EVERY abort path as `new DOMException('Aborted', 'AbortError')` (`dist/fetch.umd.js:537,579`); BOTH its `DOMException` paths set `name` — the fallback constructor explicitly assigns `this.name = name` (`fetch.umd.js:522-527`). No real RN abort lacks the `AbortError` name.
  2. **The message clause created a silent-swallow hazard.** Apollo v4's `CombinedGraphQLErrors` sets `name = "CombinedGraphQLErrors"` (`@apollo/client/errors/CombinedGraphQLErrors.js:96`) and composes `.message` by joining server error messages with `"\n"` (`:7`) — so a single server GraphQL error `{ message: "Aborted" }` arriving in an HTTP-200 body would exact-match the message clause and be dropped with no backup signal at all (RUM resource tracking sees only the 200).
  3. **The tests couldn't tell the branches apart.** The original fixture — `new Error("Aborted")` with `name` overridden to `"AbortError"` — satisfied BOTH OR-branches, so deleting the name branch would have failed zero tests (the mocked-shape-vs-real-contract trap).

## Solution

One guard in `apps/mobile/src/lib/apolloClient.ts`, placed AFTER the typed-GraphQL branch, matching on `name` only.

Before (`git show HEAD~1:apps/mobile/src/lib/apolloClient.ts` — every non-`CombinedGraphQLErrors` error reported, aborts included):

```ts
export function reportGraphqlOperationError(
  error: unknown,
  operationName: string | undefined,
): void {
  if (!isDatadogProvisioned()) return
  const operation = operationName ?? "anonymous"
  if (CombinedGraphQLErrors.is(error)) {
    const code =
      (error.errors[0]?.extensions?.code as string | undefined) ?? "unknown"
    reportDatadogError(error, { origin: "graphql_error", operation, code })
    return
  }
  reportDatadogError(error, { origin: "graphql_network_error", operation })
}
```

After (`apps/mobile/src/lib/apolloClient.ts:102-136`):

```ts
// Every real RN abort carries name "AbortError" — whatwg-fetch sets it on both
// its DOMException and fallback-Error paths. Never match on message text: a
// server GraphQL error's message could collide (e.g. exactly "Aborted").
function isClientAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    (error as { name?: unknown }).name === "AbortError"
  )
}

export function reportGraphqlOperationError(
  error: unknown,
  operationName: string | undefined,
): void {
  if (!isDatadogProvisioned()) return
  const operation = operationName ?? "anonymous"
  if (CombinedGraphQLErrors.is(error)) {
    const code =
      (error.errors[0]?.extensions?.code as string | undefined) ?? "unknown"
    reportDatadogError(error, { origin: "graphql_error", operation, code })
    return
  }
  // Client-initiated aborts (timeout budget, unmount/supersede) are noise, not
  // failures; the 15s timeout already emits graphql.client_timeout_abort (R12).
  if (isClientAbortError(error)) return
  reportDatadogError(error, { origin: "graphql_network_error", operation })
}
```

Shipped alongside: five contract-true tests in `apps/mobile/src/lib/apolloClient.test.ts:213-267` (detailed under Prevention) and the updated SDK-layer comment in `apps/mobile/src/components/DatadogRum.tsx:86-88`. The 15s timeout keeps its `graphql.client_timeout_abort` Logs marker (`apolloClient.ts:32-36`) — suppression applies only to the RUM _error_, not the Logs signal.

Verification: TDD red-green on the guard; 802/802 jest; typecheck + lint clean; simulator smoke via Expo Go against local Metro (the installed `forgewatch.app` on the iPhone sim is an embedded-bundle preview build that ignores Metro, so Expo Go is the JS-verification vehicle).

## Why This Works

**Root cause: self-inflicted aborts, reported twice.** Every burst in the idle session was the app's own 15s `fetchWithTimeout` budget calling `controller.abort()` (`apolloClient.ts:37`), or an unmount/supersede teardown aborting an in-flight request. The SDK already records each of these natively as a `-999 "cancelled"` resource error via `trackResources`/`trackErrors`; the Apollo `ErrorLink` (`createErrorLink`, `apolloClient.ts:140-144`) then reported the SAME event a second time as a `SOURCE` error. A client abort is a decision, not a failure — it carries no signal the native resource error and the `graphql.client_timeout_abort` log don't already carry.

**Why name-only matching is safe and complete.** Per the installed tree: whatwg-fetch 3.6.20 (RN's actual fetch implementation) rejects every abort as `DOMException('Aborted', 'AbortError')` with `name` set on both constructor paths (`fetch.umd.js:522-527,537,579`), and Apollo 4.1.9 passes fetch rejections to the `ErrorLink` unwrapped — so matching `name === "AbortError"` catches exactly the abort population. Genuine network failures reject as `TypeError("Network request failed")` — never abort-shaped — so they keep reporting.

**Why the guard runs AFTER the `CombinedGraphQLErrors` branch.** Typed GraphQL-in-200 errors must always report: they are invisible to RUM's resource tracking (which only sees the 200), so the error link is their ONLY signal. Running the suppress guard second makes it structurally impossible for suppression to shadow a typed report — even a pathological server error whose message is exactly `"Aborted"` routes through the GraphQL branch first (`apolloClient.ts:126-131`), and with name-only matching it couldn't match the guard anyway (`name` is `"CombinedGraphQLErrors"`, per `CombinedGraphQLErrors.js:96`). Precedence-by-ordering plus name-only matching are belt and suspenders against the exact silent-swallow the flawed draft would have shipped.

**Why the volume disappears without losing coverage.** The fix removes only the duplicate JS-side report of client-initiated aborts. Admin hangs still surface via the `graphql.client_timeout_abort` warn logs (1.42K of which pinpointed this incident); server-side GraphQL errors still report with `origin: "graphql_error"` + code; true network failures still report with `origin: "graphql_network_error"`; and the SDK's native `-999` resource errors still exist for anyone reading resource-level RUM.

## Prevention

- **Never branch on error MESSAGE; match the typed `name` first** (`docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`). This session re-proved the law from the opposite direction: here the message clause wasn't just fragile, it was a _false-negative generator_ — it could suppress a legitimate server error whose message happened to collide with the sentinel.
- **Every discriminator branch needs a test only IT can satisfy** (`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`). The flawed draft's fixture satisfied both OR-branches at once, so the suite couldn't detect deletion of either. The shipped suite (`apps/mobile/src/lib/apolloClient.test.ts:213-267`) isolates each branch:
  - the real RN abort shape (`Error` with `name = "AbortError"`, message `"Aborted"`) is skipped (`:216-221`);
  - name-only abort with _different_ message wording is skipped — message drift can't defeat the skip (`:224-229`);
  - message-only `"Aborted"` WITHOUT the name still reports — message text alone never suppresses (`:233-241`);
  - a `CombinedGraphQLErrors` whose message is exactly `"Aborted"` still reports through the GraphQL branch — precedence pinned (`:245-254`);
  - RN's real network-failure shape (`TypeError("Network request failed")`) still reports (`:256-267`).
- **Place suppress-guards AFTER typed rich-error branches.** When adding a noise filter in front of an existing reporter, order it so suppression structurally cannot shadow a typed report, and pin the ordering with a collision-shaped test (the `"Aborted"`-message `CombinedGraphQLErrors` fixture above).
- **Reusable RUM noise-triage recipe** (this is how every fact above was found): RUM Explorer grouped by `@error.message`, then × `env` × `version`, then × `@error.resource.url`; open individual error events and read the parent _session's_ full event stream (the idle-session burst cadence was the diagnosis); correlate the burst window against the Logs explorer (the `graphql.client_timeout_abort` count matched the window exactly, converting "mystery cancellations" into "our own timeout budget").
- **Open follow-ups (advisory, not shipped in PR #1616):**
  - _Superseded 2026-07-20:_ the first two follow-ups below shipped as feat-268 (operation-attributed `graphql.client_timeout_abort` — the cited `apolloClient.ts:33-35` now reads the op name off `init.headers`) and feat-267 (per-slug failure cooldown in `useHeroStream`/`prefetchHeroStream`, `heroStreamCooldown.ts`) on branch `fix/mobile-hero-jesus-slide-skip-crossfade`. Still open: the Datadog Logs monitor (operator step) and the native `-999` mute.
  - `graphql.client_timeout_abort` logs only `budget_ms` (`apolloClient.ts:33-35`) — no operation name, and no Logs monitor exists on it. It is now the _primary_ client-side signal for an admin hang; enrich it and add a monitor before production builds ship.
  - The hero retry loop is the root fix for the remaining offline noise: in true offline the pager still emits a RUM-reported `TypeError` per rotation cycle even after this fix. Candidate shapes: a per-slug failure cooldown/backoff in `useHeroStream` (`apps/mobile/src/hooks/useHeroStream.ts:31-70`) and `prefetchHeroStream` (`apps/mobile/src/hooks/useHeroStream.ts:81-109` — note it already releases a failed slug for retry at `:96-99`, so it participates in the loop), or a K-consecutive-failures latch in the pager itself.
  - The remaining native `-999 "cancelled"` stream (unfixable at the SDK layer on this config path) can be muted per-issue in Datadog Error Tracking if it drowns out real signals.

## Related Issues

- PR #1616 — `fix(mobile): stop reporting client aborts as Datadog RUM errors` (the fix; pending merge as of this writing)
- `docs/solutions/integration-issues/datadog-rn-resourceeventmapper-programmatic-config-gap.md` — why the SDK-native half of the double-report cannot be filtered on this config path (errorEventMapper is FileBasedConfiguration-only)
- `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md` — the typed-name-over-message classification law this fix reapplies
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the test-discipline META this fix's suite instantiates (branch-isolated fixtures)
- `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` — prior `@datadog/mobile-react-native` SDK integration issue (apps/tv, build layer)
- `docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md` — same feature family (mobile Datadog observability, R43 governance)
