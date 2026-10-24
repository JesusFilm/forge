---
title: "feat: web user accounts and video download gate"
type: feat
status: completed
date: 2026-05-27
roadmap: docs/roadmap/platform/feat-146-web-user-accounts-download-gate.md
origin: user request - "Add user accounts on web app. Use the same Auth as other projects. User account required to download video."
---

# feat: web user accounts and video download gate

## Decisions

- Reuse standalone `apps/auth` as the Better Auth authority.
- Keep watch pages public and cacheable; check auth only from client actions
  and route handlers.
- Require a signed-in Web session for watch download transfers directly;
  download gating is no longer behind a LaunchDarkly rollout flag.
- Use `WEB_AUTH_BASE_URL` for server-to-server session verification from
  `apps/web`.
- Use `AUTH_COOKIE_DOMAIN=.jesusfilm.org` only where production web hosts need
  the Auth session cookie on sibling/apex watch origins.
- Validate watch callbacks by origin and path; reject `/watch/api/*`, `/api/*`,
  and callbacks containing upstream media URLs.
- Treat any valid Better Auth session as sufficient for V1 downloads. The web
  download flow reuses the existing Auth app provider/email-first UI and does
  not introduce a special public email/password signup form.

## Implementation Units

1. Auth callback forwarding:
   - `apps/auth/src/auth/web-callback.ts`
   - `apps/auth/src/app/api/auth/[...all]/route.ts`
   - `apps/auth/src/app/login/*`
2. Web server-side session helpers:
   - `apps/web/src/lib/auth-session.ts`
   - `apps/web/src/app/api/auth/session/route.ts`
3. Download proxy enforcement:
   - `apps/web/src/app/api/download/route.ts`
   - Preserve existing SSRF, redirect, range, filename, and streaming behavior.
4. Watch UI flow:
   - `WatchPageClient` checks session before opening the modal.
   - `DownloadModal` re-checks before creating the final proxy anchor.
5. Validation and proof:
   - Focused Red/Green tests first.
   - Package tests, typecheck, lint.
   - User-like browser smoke with screenshots or equivalent saved proof.

## Acceptance Criteria

- Signed-out visitors can still watch.
- With the flag enabled, signed-out UI download attempts route to Auth with the
  current watch page as callback.
- With the flag enabled, signed-out direct download API requests return `401`
  before DNS or upstream fetch.
- Signed-in users can still download through the existing modal and proxy.
- The existing Auth app login/sign-up UI works with validated watch callbacks.
- Callback URLs never contain selected upstream media URLs.
- Public email/password signup remains blocked outside existing Auth provider
  flows.

## Validation Results

- Focused Red/Green tests covered Auth callback forwarding, shared feature flag
  defaults, web session route, direct download `401`, stale-session modal
  behavior, and watch UI download state.
- Full package validation passed for `@forge/web`, `@forge/auth`,
  `@forge/feature-flags`, and `@forge/watch-url-policy`: tests, typecheck, and
  lint for touched scopes.
- Browser smoke confirmed the corrected signed-out download flow at
  `http://localhost:3031/watch/jesus.html/english.html`: the watch page rendered
  the Download CTA without exposing the raw `smoke-download-high.mp4` URL,
  clicking Download redirected to the shared Auth app at
  `http://localhost:3004/login?callbackURL=...`, provider buttons and the
  email-first `Continue` flow were visible, no callback signup link appeared,
  and direct download API navigation returned
  `{"error":"Authentication required"}`. Screenshots:
  `output/playwright/web-download-watch.png` and
  `output/playwright/web-download-auth-login.png`.
- Follow-up review fixes added Red/Green coverage for server-side opaque
  download target resolution, no raw CDN URL in the watch fragment,
  production-safe Auth base defaults, callback origin config, malformed rollout
  cookies, and visible session-check failures.
