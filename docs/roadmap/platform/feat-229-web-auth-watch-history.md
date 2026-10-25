---
id: "feat-229"
title: "Web Auth Sign-In and Watch Events"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 7
depends_on:
  - "feat-146"
blocks: []
tags:
  - "platform"
  - "accounts"
  - "auth"
  - "web"
  - "watch"
---

## Problem

`apps/web` currently uses Jesus Film Auth only as a narrow download-gate session
check. The public watch app should offer optional sign-in backed by
`auth.jesusfilm.org`, similar in posture to Admin's relying-client flow, and
establish Web-local signed-in state. V1 should collect meaningful authenticated
watch events against canonical Admin video records without making normal
browsing, search, playback, or sharing require an account. Future work can use
this foundation for personalization, aggregate viewing analytics, and
sequence/pathway modeling; those outcomes are not the first deliverable.

Requirements: `docs/brainstorms/2026-07-02-web-auth-watch-history-requirements.md`

## Entry Points - Read These First

1. `docs/brainstorms/2026-07-02-web-auth-watch-history-requirements.md` - product scope, success criteria, privacy boundaries, and deferred planning questions.
2. `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` - Web app conventions; preserve public watch routing, Server Component defaults, and server-only auth/data secrets.
3. `apps/admin/src/app/api/auth/login/route.ts`, `apps/admin/src/app/api/auth/callback/route.ts`, and `apps/admin/src/auth/oauth-client.ts` - existing Auth relying-client flow to adapt conceptually.
4. `docs/roadmap/ai-chat/feat-207-chat-auth.md` - newer Auth client cautions: verify `id_token` only, avoid opaque access-token identity fallback, and preserve anonymous-first behavior.
5. `apps/web/src/lib/auth-session.ts` and `apps/web/src/app/api/auth/session/route.ts` - completed download-gate Auth session verifier and login URL builder; migrate the download gate to the new Web-local Auth session and retire or demote the old Auth-cookie verifier.
6. `apps/web/src/components/watch/WatchPageClient.tsx`, `apps/web/src/components/watch/HeroPlayer.tsx`, and `apps/web/src/components/watch/DownloadModal.tsx` - watch playback and download flows affected by signed-in state and event capture.
7. `apps/auth/AGENTS.md`, `apps/auth/CLAUDE.md`, and `apps/auth/src/domain/apps.ts` - Auth app-registration constraints and existing first-party client registrations.
8. `docs/roadmap/content-discovery/feat-090-watch-event-collection.md` - older anonymous/session-based watch-event collection ticket; reconcile storage and event shape before implementing to avoid parallel event streams.

## Grep These

- `WEB_AUTH_BASE_URL`
- `verifyAuthSession`
- `/watch/api/auth/session`
- `redirectToAuth`
- `buildAdminAuthorizeUrl`
- `verifyAdminIdToken`
- `ADMIN_OAUTH_SESSION_COOKIE`
- `HeroPlayer`
- `DownloadModal`

## What To Build

1. Add optional public Web sign-in using Jesus Film Auth as the identity authority. Use a Web-local relying-client session rather than shared `.jesusfilm.org` cookies. Anonymous visitors must still browse, search, watch, and share without signing in.
2. Register/configure Web as an Auth client for local, preview, staging, and production callback URLs. Keep redirects exact-match and environment-specific.
3. Add a small signed-out sign-in affordance and signed-in account affordance to the watch experience. The signed-in affordance must include sign-out but must not expose a watch-history UI in v1.
4. Add durable authenticated watch events. Record events only after meaningful playback, not page load. Store canonical video identity, language/variant context, event type, occurred-at time, playback position when available, and sequence-friendly ordering context.
5. Keep the watch-event model useful for future personalization, aggregate analytics, and sequence/pathway modeling, including possible Markov-chain analysis, without naming those future analyses as the v1 feature.
6. Shift the existing account-gated download flow to use the new Web-local Auth session as its signed-in check. Downloads should require sign-in directly, without a LaunchDarkly rollout flag. Do not weaken the same-origin download proxy, opaque download target lookup, Terms of Use flow, SSRF defenses, range behavior, or filename protections.

## Constraints

- Do not require sign-in for normal public Web browsing, search, playback, or sharing.
- Do not build saved videos, playlists, recommendations, account profiles, notifications, parental controls, visible watch history, or broader preferences in this slice.
- Do not add Admin, Manager, editorial, partner, or staff authorization to public Web.
- Do not depend on shared parent-domain cookies for Web's general authenticated state.
- Do not import Auth internals into `apps/web` or Web internals into `apps/auth`.
- Do not log raw per-user watch events, bearer tokens, Auth cookies, client secrets, or unnecessary identity claims.
- Do not expose user-specific watch events in static metadata, SEO output, anonymous page payloads, or public cacheable responses.

## Verification

- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/auth test` if Auth registration or callback handling changes
- `pnpm --filter @forge/auth typecheck` if Auth code changes
- `pnpm --filter @forge/auth lint` if Auth code changes
- Browser smoke: signed-out user can watch normally and sees a non-blocking sign-in affordance.
- Browser smoke: sign-in redirects to Auth, returns to Web, shows signed-in state, and sign-out clears Web signed-in state.
- Browser smoke or integration test: signed-in user watches a video past the chosen threshold and a durable watch event is persisted against the canonical video record.
- Regression: no visible watch-history page, menu entry, or recently watched surface appears in v1.
- Regression: download gate redirects/prompts when no valid Web-local Auth session exists and succeeds when the new Web-local Auth session is valid.
