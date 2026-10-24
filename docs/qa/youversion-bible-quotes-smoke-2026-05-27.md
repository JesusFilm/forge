---
title: YouVersion Bible Quotes Embed — Smoke Report
captured_at: 2026-05-27
verified_at: 2026-05-27
branch: feat/web-youversion-bible-quotes-embed
target_url: http://127.0.0.1:3000/watch/the-vine-and-the-branches/english
runtime: Next.js App Router, dev mode
status: pass-local-live-key
---

# YouVersion Bible Quotes Embed — Smoke Report

## Scope

Verify that the watch page renders a compact YouVersion-powered Bible passage
panel below the Bible Quotes carousel without breaking the existing quote
carousel, promo slide, or responsive layout.

## Environment

- Web server: `http://127.0.0.1:3000`
- Admin GraphQL: `https://admin.jesusfilm.org/api/graphql` via the local
  `WEB_ADMIN_API_KEYS` server secret.
- YouVersion key source: local `apps/web/.env` server secret.
- YouVersion version: code-owned launch default `3034` (BSB).
- LaunchDarkly rollout note: after the flag follow-up, this panel is gated by
  `forge.watch.youVersionBibleQuotes` and local smoke must set
  `FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT=true`; the default/off state
  skips YouVersion API calls and renders the existing carousel-only behavior.
- Local diagnostic: version `111` returned metadata but passage reads failed
  with `403 "Access denied for 111"` for this app key, so the PR default was
  changed to `3034`, which the key can read.

## Evidence

- Desktop screenshot:
  `output/playwright/youversion-local-3034-desktop.png`
- Mobile screenshot:
  `output/playwright/youversion-local-3034-mobile.png`
- URL rendered 2 Bible quote cards and the always-on promo slide.
- Initial panel reference:
  `JHN.15.13`
- Initial panel version:
  `data-version-id="3034"`
- Initial panel content:
  `Greater love has no one than this, that he lay down his life for his friends.`
- Mobile viewport smoke used `390x844` and rendered the Bible Quotes header,
  2 quote cards, promo slide, and YouVersion panel.
- Browser console after smoke contained HMR development messages, existing
  Next.js image warnings, an existing Mux Media Chrome stylesheet warning, and
  one resource `ERR_CONNECTION_REFUSED` unrelated to `api.youversion.com`.
- Browser request inspection captured no `api.youversion.com` requests and no
  `X-YVP-App-Key` headers, confirming YouVersion calls are server-side rather
  than browser-side.

## Attribution

YouVersion's developer documentation says Bible text display must include the
Bible Version copyright attribution:
`https://developers.youversion.com/sdks/javascript/guides/copyright-and-attribution`.

The implementation fetches version metadata server-side, fails closed when the
copyright field is missing, and renders the copyright plus publisher link below
the passage panel. The live local smoke rendered:

- `BSB · Berean Standard Bible`
- `Public Domain`

## Result

Local live-key pass.

The UI path, optional config guard, mobile layout, server-rendered passage
panel, live YouVersion passage text, attribution rendering, and absence of
browser-side YouVersion requests were verified locally with a real
`YOUVERSION_APP_KEY`.

## Release Blocker

Before marking this ready for release, repeat the desktop/mobile smoke in a
prod-like web environment to prove the deployed `@forge/web` service has the
same app-key and version configuration.

Tracked follow-up: `todos/006-pending-p1-youversion-app-key-smoke.md`.
