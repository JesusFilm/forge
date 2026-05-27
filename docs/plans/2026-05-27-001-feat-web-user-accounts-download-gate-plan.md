---
title: "feat: web user accounts and video download gate"
type: feat
status: active
date: 2026-05-27
roadmap: docs/roadmap/platform/feat-121-web-user-accounts-download-gate.md
origin: user request - "Add user accounts on web app. Use the same Auth as other projects. User account required to download video."
---

# feat: web user accounts and video download gate

## Summary

Add public user accounts to the web watch experience by reusing the existing
Better Auth service in `apps/admin`. Watch pages stay public and keep their
current `revalidate = 60` cache behavior; only the download action and
`/watch/api/download` proxy become account-gated. Public signup is enabled for
this consumer use case, but new users must be represented as consumer accounts
with no Admin, Manager, partner, or editorial privileges. Do not treat the
existing Admin `VIEWER` role as permissionless; `VIEWER` is an internal read
principal and public signup must land below that authorization boundary.
Use a LaunchDarkly server-side flag to roll the download account gate out
gradually without shipping a second auth implementation.

This is an auth and security-sensitive feature. Implementation should use a
Red/Green TDD posture for the download gate and auth callback behavior, then
finish with browser smoke proof for the signed-out and signed-up flows.

## Requirements

- R1. A signed-out visitor can watch a video page without an account.
- R2. When the LaunchDarkly gate flag is enabled for the request context, a
  signed-out visitor cannot start a download from the UI; clicking Download
  sends them to shared auth with `callbackURL` set to the current watch page.
- R3. When the LaunchDarkly gate flag is enabled for the request context, a
  signed-out direct request to `/watch/api/download?...` returns `401` before
  URL allowlist checks, DNS resolution, or upstream `fetch`.
- R4. A signed-in visitor can open the existing download modal, accept Terms
  of Use, choose a quality tier, and start the same streaming proxy download
  the app supports today.
- R5. Public signup creates a Better Auth-backed consumer account only. It must
  not grant `VIEWER`, `EDITOR`, `ADMIN`, Manager membership, partner publishing
  access, Admin GraphQL read scopes, or any other product authorization.
- R6. Auth integration reuses the shared Better Auth service in `apps/admin`;
  `apps/web` must not own a second auth database or import Admin internals.
- R7. Existing download proxy security behavior remains unchanged after an
  authenticated request passes the account gate.
- R8. The LaunchDarkly flag controls only gradual enforcement of the account
  gate. It is not an authorization substitute, and both UI and API enforcement
  must evaluate the same flag/context contract to avoid mismatched behavior.

## Scope Boundaries

In scope:

- `apps/web` download UI, same-origin session check route, and download API
  auth enforcement.
- `apps/web` server-side LaunchDarkly integration for gradual rollout of the
  account-required download gate.
- `apps/admin` shared auth trusted origins, callback handling, and signup UI.
- `apps/admin` consumer account authorization boundary for public signup. This
  may be a new role below `VIEWER` or a separate consumer flag/table, but it
  must be explicit and tested.
- Signup route abuse controls needed to safely expose public account creation.
- Environment documentation for the shared auth origin and trusted web origins.
- Tests and browser smoke for the signed-out and signed-up download flows.

Out of scope:

- Account dashboard, profile editing, password reset UX polish, email
  verification/CAPTCHA policy, subscriptions, partner roles, and publishing
  permissions. V1 explicitly treats an unverified but valid account as
  satisfying "has an account"; signup rate limiting is still in scope.
- Gating video playback, search, recommendations, share, language picker,
  study questions, or non-download watch interactions.
- Moving web reads from Strapi to Admin GraphQL.
- Changing the `VideoVariantDownload` CMS data model or download URL allowlist.

## Context and Patterns

- `apps/admin` already owns Better Auth with DB-backed sessions, cross-domain
  cookie settings, social providers, Firebase fallback, and callback origin
  validation.
- `apps/admin/src/auth/origins.ts` currently treats the auth service as
  shared infrastructure and already knows about non-admin destinations such as
  JesusFilm web and Manager.
- `apps/admin/src/app/api/auth/[...all]/route.test.ts` already expects
  `POST sign-up/email` to pass through to Better Auth. This feature should
  preserve that public signup capability but make the UI and role boundary
  explicit for web users.
- `docs/solutions/auth/better-auth-firebase-migration-must-block-public-signup.md`
  is still relevant as a warning: public signup must be a deliberate web
  consumer flow, not an accidental way to create privileged admin users.
- `apps/admin/prisma/schema.prisma` currently defaults `User.role` to
  `VIEWER`, and `apps/admin/src/auth/permissions.ts` grants that role read
  permissions. The implementation must not rely on that default as the
  permissionless public-user model.
- `apps/web/src/app/[slug]/[locale]/page.tsx` exports `revalidate = 60`.
  Do not read per-user auth in this RSC page; doing so would make the watch
  page dynamic for every visitor.
- `apps/web/src/app/api/download/route.ts` is already security-hardened.
  The new auth guard must sit before the SSRF-sensitive URL handling, then
  leave the rest of the route's behavior intact.
- Forge web currently uses env-style flags such as
  `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`; there is no existing
  LaunchDarkly integration in `apps/web`, so this feature should add a narrow
  server-only flag helper rather than a broad client-side flag framework.

## Key Decisions

- Use the shared auth host, not web-local auth. `apps/web` verifies sessions by
  making a server-side HTTP call to `${WEB_AUTH_BASE_URL}/api/auth/get-session`
  with the incoming cookie header. This keeps app boundaries clean and avoids
  adding Better Auth database/runtime ownership to `apps/web`.
- Keep watch pages cacheable. Auth state is checked only when the visitor
  clicks Download and inside the download API route. The RSC watch page does
  not receive a user/session prop.
- Use a minimal same-origin auth status route for UI gating. Add a route such
  as `apps/web/src/app/api/auth/session/route.ts` that returns
  `{ authenticated: boolean, loginUrl?: string }` and no user PII. The route
  calls the shared auth helper with `cache: "no-store"`, and when signed out it
  builds the auth URL server-side from a validated `WEB_AUTH_BASE_URL`.
- When the gate flag is enabled, redirect signed-out users to auth, not to an
  inline web modal. The Download click asks `/watch/api/auth/session` for
  state. If signed out, the client follows the returned `loginUrl`. The current
  watch page is the only callback target; the upstream media URL is never
  included.
- Treat any valid Better Auth session as sufficient for V1 downloads. Email
  verification, partner entitlements, and per-video authorization can be added
  later, but this slice only requires "has an account".
- Use LaunchDarkly as a rollout selector for the download gate. Add a boolean
  flag named `web-download-account-gate`. When it evaluates `true`, UI and API
  downloads require an account. When it evaluates `false`, the legacy download
  behavior remains available only as a controlled rollout/rollback branch.
  Once the flag has been at 100% for one stable release, create follow-up work
  to remove the legacy branch and make enforcement unconditional.
- Evaluate LaunchDarkly server-side only. Do not expose LaunchDarkly SDK keys
  or client IDs to browser code for this feature. The web session route and
  download API route should share a single helper so flag bucketing and
  fallback behavior cannot drift.
- Use a stable, non-PII rollout context key for signed-out users. Prefer an
  HttpOnly same-origin anonymous rollout cookie, for example
  `forge_download_gate_rollout`, created by the session/download route as
  needed. Do not bucket on raw email, IP address, full user agent, or signed
  media URL.
- Public signup must create a consumer authorization identity, not an Admin
  read principal. Implementation may add a `CONSUMER`/`USER` role below
  `VIEWER`, or a separate consumer-account axis, but tests must prove a
  web-created account cannot access Admin dashboard, Admin GraphQL read/write
  scopes, Manager, partner, or workflow surfaces.
- Auth callbacks from web must be path-constrained, not origin-only. Accept
  watch-page route shapes only and reject `/watch/api/*`, `/api/*`, and any
  callback that contains a selected download URL.
- After successful signup or sign-in, return to the watch page with no
  auto-resume. The visitor clicks Download again and must still accept Terms of
  Use before the proxy request is triggered.
- Preserve the existing Terms of Use gate. Authentication is required before
  the modal opens, but the user still must accept Terms of Use before the
  proxy download is triggered.
- Social provider signup is allowed only if it creates the same consumer-class
  account and cannot create `VIEWER` or higher privileges. If that is not true
  for a provider path, block that provider for public signup in this slice.
- Production auth configuration must fail closed: `WEB_AUTH_BASE_URL` must be
  HTTPS outside localhost/test and must match an explicit auth-host allowlist
  before cookies are forwarded.
- LaunchDarkly outage behavior must be explicit. Local/test can default the
  flag to `false` for developer ergonomics. Stage/prod must configure the
  fallback deliberately; the final enforcement posture should fail closed to
  account-required downloads if LaunchDarkly cannot be reached.

## Execution Workflow Requirements

- Branching and PRs must follow repo rules. Planning-only work may use a
  `docs/...` branch; implementation work should start from current
  `origin/main` on a `feat/...` branch such as
  `feat/web-user-accounts-download-gate`. Do not implement from a detached
  HEAD, and keep unrelated work out of the PR.
- Before implementation, re-check `docs/roadmap/`, `docs/solutions/`, and
  `todos/` for relevant findings, then keep this roadmap ticket
  `in-progress`. When the implementation is complete, mark the ticket
  `complete` or create follow-up `feat-NNN` tickets for deferred work.
- Use Red/Green TDD for each implementation unit that changes behavior. Add or
  update failing tests first, record the red failure, then make the smallest
  coherent change to get green. Do not skip pre-commit hooks.
- Orchestrate non-overlapping work in subagents. Good slices are:
  auth/authorization boundary, web download gate and LaunchDarkly helper,
  watch UI/browser flow, and security/test review. Subagents must not revert
  each other's changes, and their final findings should be summarized in the
  PR.
- Run the touched-scope test and typecheck commands before opening or updating
  the implementation PR. Include any package-local generation or schema drift
  checks required by `apps/admin/AGENTS.md`, `apps/web/AGENTS.md`, and the root
  guide.
- Because this is user-facing, run a user-like browser smoke test after the
  code is implemented. Capture screenshots or equivalent browser proof for the
  flag-enabled signed-out redirect, signup/callback return, download modal,
  and direct `401` path. Attach or link the proof in the PR.
- If a job, subagent review, or browser smoke surfaces a real issue that cannot
  be fixed immediately, document it in `todos/` with the failing command,
  observed error, owner/scope, and relaunch criteria. Then relaunch the
  relevant work/review loop for those surfaced todos before final handoff,
  unless the PR explicitly defers them with a follow-up ticket.

## Implementation Units

### Unit 1: Shared auth destination and signup UI

Goal: make the shared auth host intentionally support web account creation and
watch-page callbacks.

Files:

- Modify `apps/admin/src/auth/origins.ts`
- Modify `apps/admin/prisma/schema.prisma` and add a Prisma migration if the
  chosen consumer boundary uses a new role or persisted field/table
- Modify `apps/admin/src/auth/permissions.ts`
- Modify `apps/admin/src/app/login/page.tsx`
- Modify `apps/admin/src/app/login/login-page-client.tsx`
- Modify `apps/admin/src/app/api/auth/[...all]/route.ts`
- Modify `apps/admin/src/auth/rate-limit.ts` if a new route key is needed
- Modify `apps/admin/.env.example`
- Extend `apps/admin/src/app/api/auth/[...all]/route.test.ts`
- Update `apps/admin/src/app/login/page.ui.test.tsx` if the login UI has
  render coverage for provider/form states

Implementation notes:

- Add trusted production watch origins for `https://jesusfilm.org`,
  `https://www.jesusfilm.org`, and keep `https://web.jesusfilm.org`.
- Keep local origins environment-driven through `AUTH_TRUSTED_ORIGINS`; do not
  hardcode every worktree port.
- Treat `AUTH_TRUSTED_ORIGINS` as a deployment setting, not just a default.
  Stage/prod rollout must set it to include `https://jesusfilm.org`,
  `https://www.jesusfilm.org`, and `https://web.jesusfilm.org` because a
  configured env value replaces code defaults.
- Constrain web callbacks to watch-page paths. Do not accept `/watch/api/*`,
  `/api/*`, external origins, or callback URLs that include upstream media
  download URLs.
- Add signup mode to the existing `/login` page rather than a separate route,
  unless implementation finds a strong reason to update the auth-host proxy
  allowlist for `/signup`.
- In signup mode, submit to `${authApiBase}/sign-up/email` with
  `credentials: "include"` and the resolved callback URL. Better Auth requires
  `name`, `email`, and `password`; either collect `name` or derive a safe
  display name from the email prefix, and assert the exact request body in
  tests.
- Better Auth signup returns JSON; perform the trusted callback redirect in
  the client after successful signup, matching the existing sign-in flow.
- Add a consumer account boundary before public signup is exposed. Do not rely
  on the Prisma `User.role` default. If adding a new role, update the
  permission matrix so consumer accounts have no Admin GraphQL permissions.
  If using a separate table/flag, ensure `hasPermission` and Admin/Manager
  access checks still treat these accounts as non-admin.
- Wrap `sign-up/email` with `rateLimitAuthRoute({ route: "sign-up/email" })`
  before delegating to Better Auth. Reject unexpected signup fields at the
  wrapper boundary when practical, and never log raw passwords.
- Auth and signup logs must not include raw email addresses, passwords,
  cookies, session tokens, or full callback URLs. If an email identifier is
  needed for abuse analysis, hash it; for callbacks log only origin and path.
- Keep destination copy driven by `callbackURL`, so web visitors do not see
  Admin-specific language after coming from a watch page.
- Signup/signin UI states must cover pending submit, duplicate email, weak
  password, malformed email, network/provider failure, and "account exists,
  sign in instead." Errors should render with `role="alert"` and useful focus
  behavior.

Tests:

- Trusted web origins receive credentialed auth CORS headers.
- Credentialed CORS is route/method scoped to the endpoints web actually
  needs; state-changing auth endpoints reject untrusted origins.
- Untrusted callback origins still fall back safely.
- Malicious callbacks to `/watch/api/download`, `/watch/api/*`, and `/api/*`
  are rejected or replaced with a safe destination.
- `/login?mode=signup&callbackURL=<watch URL>` renders the signup form and
  posts to `sign-up/email`.
- Signup posts `name`, `email`, and `password`; success redirects client-side
  to the already-resolved trusted watch callback.
- Public signup success redirects to the provided trusted watch callback.
- Signup creates a consumer account with no `VIEWER`, `EDITOR`, `ADMIN`,
  Manager, partner, workflow, or Admin GraphQL read/write access.
- `sign-up/email` rate limiting prevents delegation to Better Auth after the
  limit is exceeded.
- Social provider signup either creates the same consumer-class account or is
  blocked for public signup.

### Unit 2: Web session verification helper

Goal: give `apps/web` a small server-only way to evaluate the download rollout
flag and ask the shared auth service whether the incoming request has a valid
Better Auth session.

Files:

- Add `apps/web/src/lib/download-gate-flag.ts`
- Add `apps/web/src/lib/auth-session.ts`
- Add `apps/web/src/app/api/auth/session/route.ts`
- Modify `apps/web/src/env.ts`
- Modify `apps/web/.env.example`
- Modify `apps/web/.env.ci`
- Modify `apps/web/vitest.setup.ts`
- Modify `apps/web/package.json` and `pnpm-lock.yaml` to add the LaunchDarkly
  server SDK, for example `@launchdarkly/node-server-sdk`, unless implementation
  finds an existing approved workspace wrapper
- Add tests near `apps/web/src/lib/` and/or the new route

Implementation notes:

- Add server env for LaunchDarkly, for example `LAUNCHDARKLY_SDK_KEY`, plus an
  explicit fallback/default env such as
  `WEB_DOWNLOAD_ACCOUNT_GATE_FALLBACK`.
- Implement a server-only flag helper around the LaunchDarkly server SDK:
  `isDownloadAccountGateEnabled(requestContext)`. The helper should evaluate
  `web-download-account-gate`, use `WEB_DOWNLOAD_ACCOUNT_GATE_FALLBACK` only
  when LaunchDarkly is unavailable, and never import into client components.
- Keep the LaunchDarkly client singleton server-scoped and lifecycle-safe for
  Next route handlers. Tests should mock the helper, not call LaunchDarkly.
- Create or reuse a stable anonymous rollout cookie for signed-out contexts.
  The cookie value should be random, non-PII, HttpOnly, SameSite=Lax, Secure in
  production, and long-lived enough to keep percentage rollout stable. Include
  `userId` only after a valid Better Auth session exists, and do not make the
  rollout bucket change after signup.
- Add a server env var such as `WEB_AUTH_BASE_URL`, defaulting locally to
  `http://localhost:3003` only for localhost/test if repo env conventions
  allow a safe default. Production/stage must set it explicitly to
  `https://auth.jesusfilm.org` or the approved auth host.
- Validate `WEB_AUTH_BASE_URL` before forwarding cookies. Outside localhost
  and test, require HTTPS and an explicit host allowlist such as
  `auth.jesusfilm.org` plus any approved stage auth host.
- The helper accepts `Headers` or a `Request`, extracts `cookie`, and calls:
  `${WEB_AUTH_BASE_URL}/api/auth/get-session?disableCookieCache=true&disableRefresh=true`.
- Use `cache: "no-store"` and a short timeout through `AbortSignal.timeout`.
- Return a narrow result, for example `{ authenticated: true, userId }` or
  `{ authenticated: false }`. The public session route should strip `userId`
  and return only `{ authenticated: boolean }`.
- Treat non-200 auth responses, null bodies, malformed JSON, and network
  failures as unauthenticated for UI/API gating.
- If the request has no `Cookie` header, return unauthenticated without calling
  the auth service. If Better Auth cookie names are stable enough to identify,
  skip the auth call for clearly unrelated cookie sets too.
- The same-origin session route accepts the current watch-page URL, validates
  that it is a watch-page callback, and returns a sanitized
  `/login?mode=signup&callbackURL=...` URL on the auth host when signed out and
  the LaunchDarkly gate is enabled. When the flag is disabled, return
  `{ gateEnabled: false, authenticated: false }` and let the client use the
  legacy modal path.
- Do not add `better-auth` as an `apps/web` dependency unless implementation
  proves the HTTP helper is insufficient.

Tests:

- LaunchDarkly flag `true` enables the account gate for both session route and
  download API helper callers.
- LaunchDarkly flag `false` preserves legacy unauthenticated download behavior
  during rollout.
- Missing LaunchDarkly env in local/test uses the documented fallback without
  network calls.
- Stage/prod fallback behavior is explicit and tested.
- Anonymous rollout cookie is non-PII and stable across signed-out then
  signed-in flows.
- Cookie header is forwarded to `/api/auth/get-session`.
- Missing cookie returns unauthenticated without calling the auth service.
- Unrelated cookies return unauthenticated without DNS, upstream media fetch,
  or auth-service work when cookie-prefix detection is implemented.
- Auth-service 200 with `user.id` returns authenticated.
- Auth-service null/malformed/error/timeout returns unauthenticated.
- The same-origin route returns no PII and returns a sanitized `loginUrl` only
  for valid watch-page callbacks.
- Invalid `WEB_AUTH_BASE_URL` values fail closed before forwarding cookies.
- `.env.ci` and `vitest.setup.ts` provide the required test env.

### Unit 3: Download API auth gate

Goal: enforce account-required downloads at the security boundary when the
LaunchDarkly rollout flag is enabled.

Files:

- Modify `apps/web/src/app/api/download/route.ts`
- Extend `apps/web/src/app/api/download/route.test.ts`

Implementation notes:

- Call the web auth helper before validating the `url` parameter, before
  `isAllowedDownloadOrigin`, before DNS pre-flight, and before upstream
  `fetch`, but only after the shared LaunchDarkly gate helper evaluates to
  enabled for the request context.
- If the LaunchDarkly flag evaluates `false`, preserve the legacy proxy route
  behavior for gradual rollout. This is the only allowed unauthenticated
  download branch, and it must be clearly covered by tests and rollout notes.
- Return `401` JSON for unauthenticated requests, for example
  `{ error: "Authentication required" }`.
- Once authenticated, preserve the existing route order and behavior exactly:
  required URL check, allowlist, filename sanitization, Range/conditional
  header forwarding, DNS public-IP pre-flight, redirect refusal, upstream
  error handling, `Content-Disposition`, no-store cache, and streaming body.
- Do not log signed URLs or cookie/session details.

Tests:

- Flag-enabled signed-out request returns `401`.
- Flag-enabled signed-out request with no cookie returns `401` without calling
  the auth service.
- Flag-enabled signed-out request does not call DNS resolution.
- Flag-enabled signed-out request does not call global `fetch` for upstream
  media.
- Flag-disabled signed-out request follows the legacy route behavior and still
  runs the existing SSRF defenses before any upstream fetch.
- Signed-in request still streams `200` with attachment headers.
- Signed-in partial-content request still preserves `206` and
  `Content-Range`.
- Existing forbidden-origin, DNS-private-IP, redirect, filename, and response
  header allowlist tests still pass.

### Unit 4: Watch UI download flow

Goal: make the Download button route flag-enabled signed-out users to account
creation while keeping signed-in users on the existing modal flow.

Files:

- Modify `apps/web/src/components/watch/WatchPageClient.tsx`
- Modify `apps/web/src/components/watch/WatchBody.tsx` only if a loading state
  needs to be passed into the button row
- Modify `apps/web/src/components/watch/DownloadButton.tsx`
- Extend `apps/web/src/components/watch/__tests__/WatchBody.test.tsx`
- Extend or add `apps/web/src/components/watch/__tests__/WatchPageClient.test.tsx`

Implementation notes:

- Change `openDownload` into an async client action:
  1. fetch `/watch/api/auth/session` with same-origin credentials
  2. if `gateEnabled` is `false`, set `modalState` to `download` and use the
     legacy flow for that rollout cohort
  3. if `gateEnabled` is `true` and authenticated, set `modalState` to
     `download`
  4. if `gateEnabled` is `true` and unauthenticated, redirect to the `loginUrl`
     returned by the session route
- Add a short pending state to prevent double-clicks while the session check is
  in flight. Disable the button, expose `aria-busy`, and keep the label short
  enough for mobile layouts.
- Keep the Download button hidden when `variant.downloads` is empty.
- Keep `DownloadModal` focused on ToS and tier choice, but re-check the session
  before creating/following the final download anchor. If the session expired,
  keep the modal open, show a recoverable alert such as "Your session expired.
  Sign in again to download," and redirect through the sanitized login URL.
- Include the current base path in API calls. Existing modal code hardcodes
  `/watch/api/download`; follow the same base-path-aware convention unless the
  implementation introduces a shared base path helper.
- Do not auto-open the modal after returning from auth. The V1 callback lands
  on the watch page, and the user explicitly clicks Download again.
- Keyboard and screen-reader coverage should include the Download pending
  state, auth error announcement, signup/signin toggle, modal focus trap, and
  mobile touch target sizing.

Tests:

- Flag-disabled Download click opens `DownloadModal` without redirecting to
  auth.
- Signed-out Download click calls the session route and redirects to the auth
  URL returned by that route when the flag is enabled.
- Signed-out redirect URL does not contain the upstream media URL.
- Signed-in Download click opens `DownloadModal`.
- Session-check failure is treated as signed-out.
- Double-click while pending does not open multiple redirects or modal states.
- Returning from auth does not auto-start a download or bypass Terms of Use.
- Stale session during final modal confirmation shows an accessible error and
  redirects to auth instead of downloading a raw `401` artifact.
- Existing DownloadModal behavior remains unchanged.

### Unit 5: Validation, smoke, and docs

Goal: prove the feature works across auth, API, and browser-visible UX.

Files:

- Update `apps/web/.env.example`
- Update `apps/web/.env.ci`
- Update `apps/web/vitest.setup.ts`
- Update `apps/admin/.env.example`
- Update `apps/admin` auth env docs and deployment notes for trusted origins,
  cookie domain, and auth base URL
- Document LaunchDarkly flag key `web-download-account-gate`, project/env
  ownership, fallback env, and the intended rollout schedule
- Optionally add a short note in `docs/solutions/auth/` only if implementation
  reveals a reusable pattern beyond this plan

Validation commands:

- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- Record Red/Green evidence for the tests that define the account gate,
  LaunchDarkly flag behavior, signup role boundary, callback validation, and
  direct download `401` path.
- If Admin auth code changes schema or Prisma models unexpectedly, stop and
  run the package-local generation flow from `apps/admin/AGENTS.md`. A new
  consumer role/field/table is allowed if that is the chosen authorization
  boundary, but it must include the corresponding migration and generated
  client updates.

Browser smoke:

- Start the relevant local web and auth services with env that shares
  `BETTER_AUTH_SECRET`, `AUTH_COOKIE_DOMAIN` omitted for localhost, and
  `AUTH_TRUSTED_ORIGINS` including the local web origin.
- Open a real watch page with downloads.
- With the LaunchDarkly flag enabled, as signed out: verify playback loads and
  Download redirects to auth. Capture a screenshot or browser trace.
- Create a public account through the signup mode.
- Verify callback returns to the same watch page. Capture proof that the
  upstream media URL never enters the callback URL.
- Click Download again, accept Terms of Use, and confirm the browser starts a
  download through `/watch/api/download`. Capture the modal/download proof.
- With the LaunchDarkly flag enabled, directly request
  `/watch/api/download?...` without cookies and verify `401`. Save the
  response proof.
- Verify the public account cannot access Admin dashboard, Admin GraphQL read
  or write scopes, Manager, partner, or workflow surfaces.
- Verify production-like cookies set by auth include `HttpOnly`, `Secure`,
  `SameSite=Lax`, and `Domain=.jesusfilm.org` where applicable.
- Verify LaunchDarkly flag disabled keeps legacy download behavior.
- Verify LaunchDarkly flag enabled requires auth in both UI and direct API
  paths.

Rollout:

- Stage with `WEB_AUTH_BASE_URL`, `BETTER_AUTH_URL`, `AUTH_COOKIE_DOMAIN`, and
  `AUTH_TRUSTED_ORIGINS` explicitly configured. Confirm configured env values
  include apex, `www`, and `web` watch origins; do not rely on code defaults.
- Configure LaunchDarkly flag `web-download-account-gate` in stage first and
  prove both variations there. Then ramp production deliberately, for example:
  internal/test contexts -> 1% -> 10% -> 50% -> 100%, with pauses for signup
  errors, download `401` rates, auth callback failures, and support reports.
- Production rollback can set the LaunchDarkly flag to 0% or target only known
  safe cohorts, but that is an explicit incident response and must be recorded
  in the deploy note. Do not silently leave public unauthenticated downloads
  open after the rollout is considered complete.
- After one stable release at 100%, create a cleanup follow-up to remove the
  flag branch and legacy unauthenticated path.
- Add a deploy note with the exact stage/prod env values checked, the account
  privilege smoke result, the LaunchDarkly variation tested, and the direct
  `401` smoke result.
- If CI or rollout verification fails, add a scoped `todos/feat-121-*.md`
  entry with the failure, evidence, and next relaunch step before retrying or
  handing off.

## Risks and Mitigations

- Risk: making the RSC watch page dynamic by reading session state during page
  render. Mitigation: only check auth from client click flow and route handlers.
- Risk: reopening the historical "public signup creates admin account" trap.
  Mitigation: public signup is explicit, lands on a consumer/no-admin
  authorization boundary below `VIEWER`, and is tested against Admin, Manager,
  partner, workflow, and GraphQL privilege assignment.
- Risk: weakening the SSRF-hardened proxy while adding auth. Mitigation:
  prepend the auth gate and keep all existing proxy tests green.
- Risk: auth callback drift between apex, `www`, and `web` hosts. Mitigation:
  add trusted-origin tests for the actual watch origins and document local and
  configured stage/prod env.
- Risk: leaking signed upstream URLs through login redirects. Mitigation:
  callback URL is always the watch page URL, never the selected download URL.
- Risk: auth service abuse from public signup or signed-out download spam.
  Mitigation: rate-limit `sign-up/email`, short-circuit no-cookie download
  attempts before auth service calls, and scope credentialed CORS by
  route/method.
- Risk: leaking credentials through a misconfigured auth base URL. Mitigation:
  validate `WEB_AUTH_BASE_URL` with HTTPS and host allowlists before forwarding
  cookies, and log only origin/path-level callback information.
- Risk: LaunchDarkly flag drift causing UI/API mismatch. Mitigation: use one
  server-only flag helper and test both the session route and download API
  against the same mocked flag variations.
- Risk: percentage rollout instability for signed-out users. Mitigation: use a
  stable anonymous rollout cookie and avoid bucketing on PII.

## Acceptance Criteria

- Watch pages remain public and cacheable.
- LaunchDarkly `web-download-account-gate=false` preserves legacy download
  behavior during controlled rollout.
- LaunchDarkly `web-download-account-gate=true` routes signed-out UI download
  attempts to shared auth.
- LaunchDarkly `web-download-account-gate=true` makes signed-out direct
  download API requests return `401` without upstream work.
- Public signup works for web visitors and returns them to the watch page.
- Signed-in users can download through the existing modal and streaming proxy.
- New public users have no `VIEWER`, `EDITOR`, `ADMIN`, Admin GraphQL,
  Manager, partner, workflow, or editorial access by default.
- Malicious auth callbacks cannot target `/watch/api/download` or other API
  routes.
- Public signup and credentialed auth CORS have route/method-scoped abuse
  controls.
- Targeted tests, typechecks, Red/Green evidence, subagent summaries, and
  browser screenshots or equivalent proof are recorded in the PR.
- Any failing job or surfaced follow-up is fixed, relaunched, or documented in
  `todos/` with explicit follow-up ownership.
