---
title: "fix: hide the Watch homepage account icon when downloads are anonymous"
type: fix
status: active
date: 2026-07-16
deepened: 2026-07-16
roadmap: docs/roadmap/platform/feat-264-watch-home-account-callback.md
---

# fix: hide the Watch homepage account icon when downloads are anonymous

## Summary

Accept the exact `/watch` homepage as a safe Auth callback and prevent passive account chrome from manufacturing an enabled account gate when the session probe fails. Preserve the existing callback-origin, API-path, and media-reference protections.

---

## Problem Frame

The global `AccountControl` sends the current `/watch` pathname to `/watch/api/auth/session`. The shared callback policy accepts only paths beginning with `/watch/`, so the exact homepage is rejected with `400 Invalid auth destination`. The control maps that non-success response to a signed-out, gate-enabled state and leaves an account icon visible even though `forge.watch.downloadAccountGate` is false.

---

## Requirements

### Callback safety

- R1. The shared Watch callback policy accepts the exact `/watch` homepage and existing nested `/watch/...` destinations on allowed origins.
- R2. The policy continues to reject lookalike paths, disallowed origins, `/watch/api/...` destinations, and callbacks containing blocked media or download references.
- R3. Web and Auth consumers resolve the exact homepage through the shared policy rather than adding app-local exceptions.

### Account-control behavior

- R4. A signed-out homepage session probe returns the real `accountGateEnabled` state and a sanitized login URL that returns to `/watch`.
- R5. The passive account control hides when the gate is off, shows sign-in when the gate is on, and remains visible for authenticated users.
- R6. A failed passive session probe does not synthesize an enabled account gate or leave a misleading signed-out icon visible.
- R9. Pending and failed passive session probes render no account affordance until a valid response establishes an authenticated or gate-enabled state.

### Verification and delivery

- R7. Browser proof on the production-shaped `/watch` route confirms the anonymous gate-off session response succeeds and the account icon is absent after hydration.
- R8. The roadmap ticket, plan, focused tests, and PR describe the same bounded callback-contract fix.
- R10. Anonymous downloads remain server-authorized: gate-on requests are rejected and gate-off requests retain their existing behavior regardless of passive header state.

---

## Key Technical Decisions

- **Extend the shared allowlist with exact equality:** Admit `pathname === "/watch"` alongside the existing `/watch/` prefix. This avoids accepting sibling paths such as `/watcher` and keeps all consumers aligned.
- **Keep the download API authoritative:** Hiding passive chrome on a session-probe error does not weaken download authorization; `/watch/api/download` continues evaluating the server-side flag and session independently.
- **Treat only runtime-valid session payloads as UI authority:** Parse the response as unknown and require boolean `authenticated` and `accountGateEnabled` fields before rendering account chrome. Invalid shapes fail hidden and clear stale Datadog identity.
- **Retain the Web-local sign-in navigation contract:** `AccountControl` continues routing through the Web login endpoint with the current path as `returnTo`; consumer tests cover that actual path instead of treating the session response's login URL as proof of click navigation.
- **Use layered contract tests:** Cover the shared policy, Web session response, Auth wrapper, and account-control fallback so a locally green helper change cannot drift at a consumer boundary.
- **Avoid unrelated auth changes:** OAuth storage, cookies, Auth UI, download-target resolution, and LaunchDarkly configuration remain outside this fix.

---

## High-Level Technical Design

The change admits one safe path at the shared callback-policy boundary. Passive presentation may fail hidden, but the Web download route remains the only authority that decides whether an anonymous request can download.

```mermaid
flowchart TB
  AC[AccountControl on /watch] -->|session callback=/watch| WS[Web session route]
  WS -->|normalize with request origin| P[shared watch-url-policy]
  WS --> F[download account flag]
  WS --> S[Web session verification]
  P --> J[truthful session response]
  F --> J
  S --> J
  J -->|authenticated or gate-on only| AC

  AC -->|sign-in returnTo=/watch| WL[Web login route]
  WL --> P
  WL --> OA[Auth OAuth flow]
  OA --> WC[Web auth callback]
  WC --> W[/watch]

  AU[Auth callback consumers] -->|absolute URL and trusted origins| P

  D[Download request] --> DG[server download gate]
  DG --> F
  DG --> S
  DG -->|anonymous and gate-on| X[401]
  DG -->|gate-off or authenticated| OK[Download]
```

Ownership remains explicit: Web normalizes request-relative destinations, the shared package validates origins and Watch paths, Auth reuses the same absolute-URL policy, and the download route enforces access independently of header rendering.

---

## Scope Boundaries

### In scope

- The exact `/watch` callback contract in `@forge/watch-url-policy`.
- Web/Auth consumer regressions for the homepage callback.
- Passive `AccountControl` behavior while its session request is pending or failed.
- Anonymous browser verification on `/watch` plus a nested Watch-route smoke.

### Deferred to Follow-Up Work

- Broader account-navigation or history UX changes.
- Retry/reconnect behavior and reserving a permanent header slot during an Auth outage; this fix removes the false affordance without redesigning account availability or header layout.
- LaunchDarkly targeting changes or enabling the download account gate.
- Existing forwarded-host trust policy and `HEAD` download authorization semantics; neither is changed by admitting the exact homepage or correcting passive UI fallback.
- Refactoring the wider OAuth callback stack.

---

## Implementation Units

### U0. Establish a current implementation base

- **Goal:** Start implementation from the current default branch without losing the plan or unrelated user work.
- **Requirements:** R8.
- **Dependencies:** None.
- **Files:** Git branch state only; no content changes.
- **Approach:** Inspect status, fetch `origin`, verify `feat-264` remains the next available roadmap ID, create `fix/watch-home-account-icon` from refreshed `origin/main`, and confirm both untracked documents remain intact before editing.
- **Patterns to follow:** The repository branch and user-work preservation rules in `AGENTS.md`.
- **Test expectation:** none -- this is an environment prerequisite.
- **Verification:** The branch merge-base is refreshed `origin/main`, every referenced implementation/test path exists, and unrelated `docs/brainstorms/2026-05-28-manager-enrichment-mastra-consolidation-requirements.md` is unchanged.

### U1. Track the homepage callback regression

- **Goal:** Create the required platform roadmap record and keep it aligned with the implementation lifecycle.
- **Requirements:** R8.
- **Dependencies:** U0.
- **Files:** `docs/roadmap/platform/feat-264-watch-home-account-callback.md`, `docs/roadmap/README.md`.
- **Approach:** Record the production symptom, exact entry points, security constraints, and verification targets with status `in-progress`. Generate the canonical roadmap index with `pnpm --filter roadmap generate:readme`; final ticket completion belongs to U4 after validation.
- **Patterns to follow:** `docs/roadmap/platform/feat-244-watch-download-account-flag.md` and the roadmap format in `CLAUDE.md`.
- **Test expectation:** none -- roadmap metadata and index formatting are documentation-only.
- **Verification:** The generated roadmap index contains exactly one `platform/feat-264` entry and the in-progress ticket describes the planned scope.

### U2. Admit the exact Watch homepage through the shared callback policy

- **Goal:** Make `/watch` a valid sanitized return destination without widening the existing security boundary.
- **Requirements:** R1, R2, R3.
- **Dependencies:** U1.
- **Files:** `packages/watch-url-policy/src/index.ts`, `packages/watch-url-policy/src/index.test.ts`, `apps/auth/src/auth/web-callback.test.ts`, `apps/web/src/app/api/auth/login/route.test.ts`.
- **Approach:** Extend the path predicate with an exact homepage case while preserving origin, protocol, API-path, and blocked-reference checks.
- **Constraint:** Broaden only the path predicate; do not return early for `/watch`, so exact-homepage callbacks still traverse origin and blocked-reference checks.
- **Execution note:** Start with failing policy and Auth-wrapper regressions for the exact homepage.
- **Patterns to follow:** Existing `resolveWatchCallbackURL` allowlist tests and Auth wrapper tests.
- **Test scenarios:**
  - An allowed production or preview origin with pathname `/watch` resolves successfully.
  - An allowed nested `/watch/...` callback continues to resolve.
  - `/watcher`, `/watch-evil`, external origins, `/watch/api/...`, encoded API separators, and media-bearing parameters remain rejected.
  - Exact-homepage negatives include an external-origin `/watch`, `/watch?url=...`, `/watch?next=<allowed media URL>`, and `/watch?next=<Mux reference>` so the new branch cannot bypass existing checks.
  - The Auth wrapper accepts an allowed-origin homepage callback without changing its rejection behavior.
  - The Web login route accepts `returnTo=/watch`, sanitizes it to the request-origin absolute homepage, and preserves its documented safe fallback for API or media-bearing destinations. Use an allowed request origin different from configured `WEB_BASE_URL` so the accepted value cannot be confused with the fallback.
- **Verification:** Shared-policy, Auth-wrapper, and Web login-route focused suites pass with the new homepage contract and existing security cases intact.

### U3. Return truthful homepage session state and fail passive chrome hidden

- **Goal:** Make the homepage session request succeed and prevent transport failures from producing a false account icon.
- **Requirements:** R4, R5, R6, R9, R10.
- **Dependencies:** U2.
- **Files:** `apps/web/src/app/api/auth/session/route.test.ts`, `apps/web/src/components/watch/AccountControl.tsx`, `apps/web/src/components/watch/__tests__/AccountControl.test.tsx`, `apps/web/src/app/api/download/route.auth.test.ts`.
- **Approach:** Add the relative `/watch` endpoint contract and keep the account control non-rendering while pending or failed. Parse successful JSON as unknown; require boolean `authenticated` and `accountGateEnabled`, and require any authenticated `user` to be absent or object-shaped before it may drive UI. Invalid shapes fail hidden and clear stale Datadog identity. Preserve valid gate-on and authenticated rendering and server-side download enforcement.
- **Execution note:** Add failing route and component regressions before changing the fallback.
- **Patterns to follow:** Existing session-route response assertions and `AccountControl` state tests.
- **Test scenarios:**
  - Signed-out `callbackURL=/watch` returns `200`, `accountGateEnabled:false`, and a sanitized login URL whose return destination is the homepage.
  - Gate-on homepage responses keep the signed-out sign-in affordance; activating it navigates through `/watch/api/auth/login?returnTo=%2Fwatch`.
  - Authenticated responses keep the account menu regardless of gate state.
  - A deferred fetch promise proves the control is absent before settlement, then resolves to each valid gate-off, gate-on, and authenticated final state.
  - Non-success, invalid JSON, `null`, arrays, missing booleans, string booleans, conflicting authenticated-user values, and rejected session requests settle to hidden rather than signed-out and clear stale Datadog identity.
  - Anonymous download requests remain rejected when the gate is on and retain existing behavior when it is off.
- **Verification:** Focused Web tests prove the icon state is derived only from a runtime-valid session response and that server-side download authorization is unchanged for both gate-on and gate-off requests.

### U4. Validate the production-shaped browser flow

- **Goal:** Prove the user-visible regression is resolved on the exact route that exposed it.
- **Requirements:** R7, R8, R9, R10.
- **Dependencies:** U2, U3.
- **Files:** `output/playwright/watch-home-anonymous-account-hidden.png`.
- **Approach:** Run the Web app with the LaunchDarkly SDK disabled and `FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT=false`, load `/watch` anonymously, record the session request URL/status/body, inspect the hydrated DOM, capture visual proof, then smoke a nested Watch video route. Use the unresolved-request component regression as the authoritative transient-state proof; the screenshot proves the settled visual state.
- **Patterns to follow:** Existing Watch browser proof conventions and `forge-watch-live-triage` outside-in checks.
- **Test scenarios:**
  - The `/watch` session request with the relative callback succeeds and reports the gate off.
  - A deliberately unresolved session request renders no account control, and no persistent account control renders after a valid gate-off response.
  - A nested Watch video route retains its existing anonymous gate-off behavior and current-path callback contract.
- **Verification:** Focused tests, Web/Auth/shared-package typechecks and lint, browser DOM evidence, and a screenshot all agree on the corrected behavior. Mark the roadmap ticket and plan complete, regenerate the roadmap index, and confirm the ticket, plan, tests, and PR summary describe the same bounded callback-contract fix.

### U5. Publish the bounded fix

- **Goal:** Deliver the verified change as a reviewable pull request.
- **Requirements:** R8.
- **Dependencies:** U4.
- **Files:** Git commit and GitHub PR metadata only.
- **Approach:** Commit only scoped files, push the feature branch, create a PR whose summary and validation match the completed roadmap ticket and plan, then watch required checks and verify mergeability.
- **Patterns to follow:** The repository Compound Engineering commit/push/PR workflow.
- **Test expectation:** CI reruns the repository-defined checks; fix any failures caused by this branch before handoff.
- **Verification:** The remote branch exists, the PR is open and mergeable, required checks are green, and ignored local visual evidence is summarized in the PR rather than claimed as a tracked artifact.

---

## Risks & Dependencies

- **Callback allowlist widening:** An imprecise prefix could admit lookalike, encoded API, or media-bearing paths. Mitigate with exact `/watch` equality and explicit negative tests that keep the existing origin and query checks active.
- **Hidden outage signal:** Fail-hidden removes a passive sign-in affordance during session-service failure, but download authorization remains server-enforced and user-initiated download flows retain explicit session errors.
- **Split login surfaces:** Auth wrapper coverage does not prove the Web-local sign-in click path. Cover both consumers of the shared policy and the Web login endpoint's real `returnTo=/watch` contract.
- **Stale checkout:** The current worktree is detached behind `origin/main`; implementation must branch from freshly fetched `origin/main` while preserving unrelated user files.

---

## Acceptance Examples

- **Anonymous homepage, gate off:** Given an anonymous visitor on `/watch`, when the account control checks the session, then the response is successful and no account icon remains visible.
- **Anonymous homepage, gate on:** Given the gate evaluates true, when the homepage session check completes, then the sign-in control is visible and its return destination is `/watch`.
- **Session failure:** Given the passive session request fails, when the account control settles, then it does not claim the account gate is enabled or show a misleading sign-in icon.
- **Unsafe callback:** Given a callback targets `/watch/api/...`, a lookalike path, another origin, or a blocked media reference, when the shared policy evaluates it, then the callback remains rejected.
- **Server authorization:** Given the header session probe is pending or failed, when an anonymous visitor requests a download, then the download route still decides access from the server-side flag and verified session.

---

## Sources & Research

- `packages/watch-url-policy/src/index.ts` owns the shared callback allowlist consumed by Web and Auth.
- `apps/web/src/components/watch/AccountControl.tsx` maps session results into hidden, signed-out, and signed-in chrome.
- `apps/web/src/app/api/auth/session/route.ts` composes the flag result, session state, and sanitized login destination.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` establishes layered route-contract verification across consumers.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` supports adding production-contract assertions beyond helper-shape tests.
