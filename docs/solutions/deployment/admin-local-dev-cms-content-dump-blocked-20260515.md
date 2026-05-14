---
title: Running `triggerExperienceContentDump` locally is blocked behind a three-layer auth/proxy gauntlet
date: 2026-05-15
last_updated: 2026-05-15
category: deployment
module: apps/admin
problem_type: workflow_issue
component: dev_environment
root_cause: dev_env_gap
resolution_type: deferred
severity: medium
applies_when:
  - Trying to populate admin's local Experience corpus with real cms (Strapi) content for local-dev parity.
  - Trying to invoke any ADMIN-only GraphQL mutation that also dispatches a useworkflow job from a local-dev machine.
  - Debugging why `/dashboard` redirects infinitely on `localhost:3003` after a successful login.
tags:
  - better-auth
  - workflow
  - useworkflow
  - dev-environment
  - dashboard-redirect-loop
  - auth-host-proxy
  - cms-content-dump
  - experience-locale
  - WORKFLOW_API_KEYS
  - permissions
---

## What this is

This is the post-mortem of a 2026-05-15 attempt to get prod-equivalent Experience content (Easter, Christmas, etc.) into a local admin DB by running the `triggerExperienceContentDump` GraphQL mutation. The mutation exists, the cms-side data is in local Strapi (13 components for easter), but three stacked dev-environment quirks each block a different path to invoking it.

## The three layers

### Layer 1 — Auth host proxy 404s `/api/graphql` on `localhost:3003`

`apps/admin/src/proxy.ts:79-81` returns `404 Not Found` for any path starting with `/api/` (except `/api/auth/*`) when the request origin matches `getAuthBaseURL()`. In dev that's `http://localhost:3003` by default, so:

- `localhost:3003/api/graphql` → 404 from middleware
- `127.0.0.1:3003/api/graphql` → bypasses middleware, but Better Auth's session cookie is host-only on `localhost` and won't be sent to `127.0.0.1`

### Layer 2 — `/dashboard` redirect loop on `localhost:3003`

`apps/admin/src/proxy.ts:54-60`'s `redirectAuthPageToAdmin` redirects any non-auth path to `getDefaultPostLoginURL()`. In production, that resolves to `https://admin.jesusfilm.org/dashboard` (a different origin from `https://auth.jesusfilm.org`), so the redirect lands cleanly. In dev with no `AUTH_TRUSTED_ORIGINS` set:

- `getAuthTrustedOrigins()` returns `[]`
- `primaryAppOrigin` is `undefined`
- `getDefaultPostLoginURL()` falls back to `${getAuthBaseURL()}/dashboard` = `http://localhost:3003/dashboard`
- Same origin as the request → middleware fires again → redirect again → `ERR_TOO_MANY_REDIRECTS`

User-impacting workaround in the repo (memory): use `127.0.0.1:3003` for `/dashboard` to bypass the proxy. Works for the dashboard, breaks for `/login` (cookie doesn't transfer).

### Layer 3 — Workflow runner can't reach its own webhook in dev

When `triggerExperienceContentDump` finally resolved (after we wired up `WORKFLOW_API_KEYS` + temporarily widened the `WORKFLOW_TRIGGER` permission allowlist to include `write:experience-content-dump`), the mutation hung indefinitely. Admin's logs:

```
[local world] Queue operation failed: [TypeError: fetch failed] {
  [cause]: Error: redirect count exceeded
}
```

The useworkflow runner's "local world" queue dispatches HTTP callbacks to the admin server's own webhook URL. That URL gets caught by the same auth-host proxy chain as `/dashboard`, redirects loop, dispatch fails, mutation never completes. We killed the curl at the 2-minute mark with the `experience_locale` row unchanged.

## What we tried (and what didn't work)

| Approach                                                   | Why it failed                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `WEB_ADMIN_API_KEYS` bearer (`CONSUMER_BEARER` role)       | Permission set is intentionally empty                                                                            |
| `WORKFLOW_API_KEYS` bearer (`WORKFLOW_TRIGGER` role)       | `WORKFLOW_TRIGGER_PERMISSIONS` doesn't include `write:experience-content-dump`                                   |
| Login form on `localhost:3003/login`                       | Submits as GET (form has no `method` attr; React hydration broke due to host-mismatch); password leaked into URL |
| Login form on `127.0.0.1:3003/login`                       | Better Auth's `authBaseURL` is baked at `localhost:3003`, mismatched origin breaks client hydration the same way |
| Login success + browse `/dashboard` on localhost           | Layer 2 redirect loop                                                                                            |
| DB session token as Cookie to `localhost:3003/api/graphql` | Layer 1 404                                                                                                      |
| DB session token as Cookie to `127.0.0.1:3003/api/graphql` | Better Auth signature mismatch — token from DB is unsigned, expected signed cookie value                         |
| Signed cookie via HMAC-SHA256 with `BETTER_AUTH_SECRET`    | Signature format guess didn't match; principal stayed `PUBLIC`                                                   |
| Widen `WORKFLOW_TRIGGER_PERMISSIONS` + use bearer          | Auth resolved ✓ but Layer 3 hung the workflow dispatch                                                           |

## What works locally without a real dump

Hand-edit `experience_locale.blocks` JSON directly. The Apollo + Pothos layer reads the JSON column as-is, maps `t` → `__typename`, and the apps/web renderer dispatches on `__typename` correctly. The Experience-precedence routing fix in `apps/web/src/app/[slug]/[locale]/page.tsx` (commit `3c8c7d78`) is independently verifiable that way.

Limitation: rich block sets (the prod Easter page has ~98 headings spread across video carousels, bible quotes, info blocks, CTAs, etc.) require hand-crafting hundreds of lines of JSON — throwaway work that doesn't ship.

## How to actually fix this

The cleanest path is a dedicated apps/admin branch that addresses Layer 1, 2, and 3 together:

1. **Layer 1 fix:** Skip the auth-host proxy when `getAuthBaseURL() === getDefaultPostLoginURL().origin` (i.e., when there's no distinct admin origin from the auth origin in dev). One condition in `proxy.ts:proxy()`.
2. **Layer 2 fix:** Same condition fixes the `/dashboard` loop simultaneously.
3. **Layer 3 fix:** Configure the useworkflow runner's webhook base URL via env var so it can point at the admin server's internal-IP / `127.0.0.1` directly in dev, bypassing its own auth-host gate.

Alternatively, ship a `pnpm --filter @forge/admin run-content-dump` CLI script that imports the service layer (`dumpExperienceLocale`) directly with a synthetic `ADMIN` principal — bypasses GraphQL auth + useworkflow dispatch entirely. Mirrors the `pnpm run-embeds` script the R1/R2 backfills use locally.

## Why this is deferred

The fix is admin-side. The current branch (`feat/web-admin-polish`) is scoped to apps/web polish ahead of the data-layer-flip. Touching admin's auth + workflow runner in this branch would expand the diff into territory that needs its own regression sweep against admin's dashboard, login, OAuth flow, and workflow dispatch.

The local-dev gauntlet documented here does NOT affect production. In prod:

- `auth.jesusfilm.org` and `admin.jesusfilm.org` are distinct origins, so Layers 1 and 2 don't fire.
- Layer 3's webhook URL resolves via Railway internal networking, no proxy in the path.

## Pointers

- The earlier related learning: `prisma-video-relation-inverted-back-references-20260514.md` (also a latent bug that only becomes user-visible after the data-layer-flip ships).
- The Experience-precedence routing fix that lets editor-curated Experiences override slug-colliding Videos: commit `3c8c7d78` on `feat/web-admin-polish`.
- The local Strapi has real-ish data for `easter` (13 components, 12 sections + 1 video-hero). The cms-content-dump would translate those into admin's per-locale blocks JSON if it could run.
