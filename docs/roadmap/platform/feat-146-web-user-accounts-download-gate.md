---
id: "feat-146"
title: "Web User Accounts and Video Download Gate"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-27"
duration: 7
depends_on:
  - "feat-144"
blocks: []
tags:
  - "platform"
  - "accounts"
  - "auth"
  - "web"
  - "download"
  - "launchdarkly"
---

## Problem

The web watch experience should stay public, but video downloads should require
a user account during a gradual LaunchDarkly rollout. The implementation must
reuse the standalone Jesus Film Auth service in `apps/auth`; `apps/web` must
not own auth state or import another app's internals.

## Entry Points - Read These First

1. `apps/web/src/components/watch/WatchPageClient.tsx` - starts the
   client-side download flow and must not receive raw CDN download URLs.
2. `apps/web/src/components/watch/DownloadModal.tsx` - renders download tiers,
   probes sizes, re-checks auth, and creates the final same-origin proxy anchor.
3. `apps/web/src/app/api/download/route.ts` - enforces the account gate before
   URL validation, DNS pre-flight, and upstream fetch.
4. `apps/web/src/lib/download-target.ts` - resolves opaque
   `videoSlug`/`variantId`/`downloadId` values to the server-only CDN URL.
5. `apps/web/src/app/api/auth/session/route.ts` and
   `apps/web/src/lib/auth-session.ts` - validate the current Auth session and
   build sanitized login redirects.
6. `apps/auth/src/auth/web-callback.ts` and `apps/auth/src/app/login/*` -
   preserve the existing Auth app login surface for watch callbacks.
7. `packages/feature-flags/src/registry.ts` and
   `apps/web/src/lib/feature-flags.ts` - define and evaluate
   `forge.watch.downloadAccountGate`.

## Grep These

- `forge.watch.downloadAccountGate`
- `FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT`
- `forge_download_gate_rollout`
- `resolveWatchDownloadTarget`
- `resolveWatchCallbackURL`
- `resolveWebWatchCallbackURL`
- `WEB_AUTH_BASE_URL`
- `AUTH_WEB_TRUSTED_ORIGINS`

## What To Build

- Add the shared LaunchDarkly flag `forge.watch.downloadAccountGate`, disabled
  by default and backed by local/test fallback
  `FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT=false`.
- Add a web session route at `/watch/api/auth/session` that returns only
  download-gate state and a sanitized Auth login URL.
- Gate `GET` and `HEAD` `/watch/api/download` before URL allowlisting, DNS, or
  upstream fetch when the flag is enabled.
- Keep raw `VideoDubDownload.url` values server-only. The watch client may
  receive `downloadId`, `variantId`, and `videoSlug`; the download route resolves
  the real URL server-side after the auth gate.
- Reuse the existing `apps/auth` provider/email-first login UI for valid watch
  callbacks. Do not add a bespoke web login/signup surface.
- Preserve Firebase-migration public-signup protection; direct public
  `/signup?callbackURL=...` must not render signup mode for watch callbacks.

## Constraints

- Do not import Auth internals into `apps/web` or web internals into `apps/auth`.
- Do not expose LaunchDarkly server-side SDK keys to browser bundles or
  `NEXT_PUBLIC_*` vars.
- Do not send raw upstream media/download URLs to client components or page
  payloads.
- Do not weaken the existing download proxy SSRF, redirect, range, filename, or
  streaming defenses.
- Do not use localhost Auth defaults in production runtime.
- Do not add Admin, Manager, partner, workflow, or editorial authorization to
  this public web-download V1.

## Verification

- Red/Green tests for Auth callback forwarding, shared LaunchDarkly defaults,
  production-safe Auth URL resolution, web callback sign-in, session route,
  direct download `401`, server-side opaque download target resolution,
  rollout-cookie stickiness, signed-in download, and stale/session-failure modal
  behavior.
- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- User-like browser smoke with screenshot or equivalent captured proof for
  signed-out redirect, existing Auth login UI, download modal, and direct `401`.

## Completion Notes

- Implemented behind shared LaunchDarkly flag key
  `forge.watch.downloadAccountGate` with local/test fallback
  `FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT=false`.
- Smoke surfaced a Better Auth trusted-origin callback rejection for the web
  watch callback. Fixed by adding validated web origins to Auth
  `trustedOrigins` via `getAuthTrustedOrigins()`.
- Follow-up review found that raw CDN download URLs were still serialized to the
  browser. Fixed by removing `downloads.url` from the watch-page fragment and
  resolving downloads by opaque IDs inside `/watch/api/download`.
- Follow-up review corrected duplicate roadmap ID `feat-144` to `feat-146`; the
  feature depends on `feat-144` LaunchDarkly foundation.
- Final smoke proof captured
  `output/playwright/web-download-watch.png` and
  `output/playwright/web-download-auth-login.png`, verified the shared Auth app
  login UI, confirmed no raw smoke download URL in the watch DOM, and confirmed
  direct signed-out download navigation returns `Authentication required`.
