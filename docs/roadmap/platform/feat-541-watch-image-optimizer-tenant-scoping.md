---
id: "feat-541"
title: "Scope the Watch image optimizer to our own CDN tenants"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-06"
duration: 3
depends_on:
  - "feat-536"
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

feat-536 gave every `images.remotePatterns` entry a `pathname`, which genuinely
closed the open image proxy for `images.unsplash.com` (pinned to the two fixed
placeholder photos the app renders). It did **not** close it for the other two
hosts, and the PR says so rather than claiming otherwise.

`imagedelivery.net` and `image.mux.com` are multitenant CDNs whose URL shape is
identical for every customer:

- Cloudflare Images: `/<account-hash>/<image-id>/<variant>` — matched by `/*/*/**`
- Mux image derivatives: `/<playbackId>/<asset>` — matched by `/*/*`

So `GET /watch/_next/image?url=https://imagedelivery.net/<someone-else's-account-hash>/<id>/public`
still resolves, and web's origin fetches, transforms and re-serves an arbitrary
third party's image under `jesusfilm.org`. Same abuse class as the audited Unsplash
bug (bandwidth and transform cost amplification, plus confused-deputy branding of
third-party images as Watch content) — narrowed from one fully-open host to two
shape-bounded ones, not removed.

Path shape cannot express tenancy, so no `remotePatterns` change can fix this.

## Entry Points — Read These First

1. `apps/web/next.config.mjs` — the `imagedelivery.net` and `image.mux.com` entries
   and the comments that state the shape-only limitation.
2. `apps/web/scripts/next-config.test.mjs` — `describe("Next.js image optimizer is
not an open proxy")`, including the NOTE that these two assert shape only.
3. `docs/roadmap/platform/feat-536-watch-security-header-baseline.md` — the
   originating work and its "What To Build" caveat.
4. `apps/web/src/lib/download-allowlist.ts` — the existing origin-allowlist pattern
   and its documented redirect-chain limitation.

## Grep These

- `remotePatterns`
- `imagedelivery.net`
- `image.mux.com`
- `_next/image`

## What To Build

Pick one; the first is cheaper, the second is complete.

1. **Tenant pinning.** Derive the Cloudflare Images account hash and the accepted
   Mux environment from configuration rather than accepting any tenant, e.g.
   `pathname: "/<account-hash>/**"`. Optional env var, `.optional()` per the repo's
   opt-in-scaffolding rule, falling back to today's shape-only pattern so no
   environment breaks on deploy. This closes cross-tenant abuse but still trusts
   any id within our own accounts.
2. **Asset-record validation.** Route optimized images through a handler that
   resolves the requested playback id / image id against admin's own asset records
   before fetching. Complete, but it puts a lookup on the image hot path and needs
   a cache; size that before committing to it.

## Constraints

- Do NOT regress the 28 real image-optimizer requests the feat-536 browser smoke
  captured; that run is the regression baseline.
- Do NOT reintroduce a hostname-only pattern for any host.
- Keep the Unsplash pins as they are — that host is already closed.
- Any new env var is `.optional()` with a working fallback.

## Verification

- `pnpm --filter @forge/web test scripts/next-config.test.mjs` — add a case proving
  a foreign account hash / playback id is rejected by `matchRemotePattern`, with an
  anti-vacuous companion proving our own still matches.
- `next build` + `next start`, then load `/watch` against real admin data and
  confirm 0 failed `_next/image` requests.
- `curl` a foreign-tenant URL through `/watch/_next/image` and assert non-200.
