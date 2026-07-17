---
id: "feat-264"
title: "Watch homepage account callback"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-16"
duration: 1
depends_on:
  - "feat-244"
blocks: []
tags:
  - "platform"
  - "accounts"
  - "auth"
  - "web"
  - "download"
---

## Problem

The global Watch account control sends the current path to the session route as
its callback destination. The shared callback policy accepts nested
`/watch/...` paths but rejects the exact `/watch` homepage. The homepage session
probe therefore returns `400 Invalid auth destination`, and the client converts
that failure into a gate-enabled signed-out account icon even when
`forge.watch.downloadAccountGate` is disabled.

## Entry Points - Read These First

1. `packages/watch-url-policy/src/index.ts` - owns the callback origin, path,
   API, and media-reference allowlist shared by Web and Auth.
2. `apps/web/src/app/api/auth/session/route.ts` - returns the evaluated download
   account flag, Web session state, and sanitized login destination.
3. `apps/web/src/components/watch/AccountControl.tsx` - maps the passive session
   response into hidden, signed-out, and signed-in header states.
4. `apps/web/src/app/api/download/route.ts` - remains the authoritative
   server-side account gate for download requests.
5. `apps/auth/src/auth/web-callback.ts` - reuses the shared callback policy for
   Auth return destinations.

## Grep These

- `resolveWatchCallbackURL`
- `callbackURL`
- `accountGateEnabled`
- `AccountControl`
- `downloadAccountGate`
- `Invalid auth destination`

## What To Build

- Accept the exact `/watch` pathname through the existing shared callback
  policy without widening the origin, API-path, or media-reference rules.
- Prove the corrected contract at the shared policy, Auth wrapper, Web login,
  and Web session-route boundaries.
- Keep the account control absent while its passive request is pending and when
  the response is unsuccessful or malformed.
- Continue rendering sign-in when a valid response reports the gate enabled and
  the account menu when a valid response reports an authenticated user.
- Preserve the download route as the independent server-side authorization
  boundary.

## Constraints

- Do not enable or retarget the LaunchDarkly account gate.
- Do not add app-local callback exceptions or bypass the shared policy.
- Do not weaken rejection of external origins, lookalike paths,
  `/watch/api/...`, or callback parameters containing download/media targets.
- Do not change OAuth cookies, Auth storage, or download-target resolution.
- Preserve unrelated user work in the current worktree.

## Verification

- Shared callback-policy tests cover exact `/watch` success and exact-homepage
  negative origin/media cases.
- Auth and Web route tests prove their real consumers accept the safe homepage
  while preserving unsafe-input fallback or rejection behavior.
- Account-control tests prove no loading/error icon, strict response-shape
  validation, gate-on sign-in navigation, and authenticated account rendering.
- Download authorization regressions remain green for both gate-on and gate-off
  behavior.
- Anonymous browser smoke on `/watch` records a successful gate-off session
  response, an absent account control after hydration, and visual proof.
