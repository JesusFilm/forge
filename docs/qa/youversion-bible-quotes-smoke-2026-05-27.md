---
title: YouVersion Bible Quotes Embed — Smoke Report
captured_at: 2026-05-27
verified_at: 2026-05-27
branch: feat/web-youversion-bible-quotes-embed
target_url: http://127.0.0.1:3000/watch/the-vine-and-the-branches/english
runtime: Next.js App Router, dev mode
status: partial
---

# YouVersion Bible Quotes Embed — Smoke Report

## Scope

Verify that the watch page renders a compact YouVersion-powered Bible passage
panel below the Bible Quotes carousel without breaking the existing quote
carousel, promo slide, or responsive layout.

## Environment

- Web server: `http://127.0.0.1:3000`
- Admin GraphQL: local admin dev server on `127.0.0.1:3013`
- YouVersion key source: **not available** in local `.env` or Forge web Doppler
  dev config at the time of testing.
- YouVersion smoke key: `local-smoke-app-key`, intentionally fake and supplied
  only to the local server process.
- Server-fetch shim: `/private/tmp/mock-youversion-fetch.mjs` intercepted
  `https://api.youversion.com/v1/*` inside the Node dev server and returned
  deterministic version/passage JSON. This proves the browser receives
  server-rendered passage data without exposing the app key, but it is not a
  real YouVersion API credential validation.

## Evidence

- Desktop screenshot:
  `output/playwright/youversion-bible-quotes-server-desktop.png`
- Mobile screenshot:
  `output/playwright/youversion-bible-quotes-server-mobile.png`
- URL rendered 2 Bible quote cards and the always-on promo slide.
- Initial panel reference:
  `JHN.15.13`
- Initial panel content:
  `Mock YouVersion passage content for JHN.15.13.`
- After selecting the second quote, panel reference:
  `JHN.15.5`
- After selecting the second quote, panel content:
  `Mock YouVersion passage content for JHN.15.5.`
- After advancing to the promo slide with the carousel Next button, the panel
  was hidden.
- Mobile viewport smoke used `390x844` and rendered the Bible Quotes header,
  2 quote cards, promo slide, and YouVersion panel.
- Browser console after smoke contained React DevTools/HMR development
  messages, existing Next.js LCP image warnings, and an existing Mux Media
  Chrome stylesheet warning.
- Browser network inspection for `youversion` showed no captured requests,
  confirming YouVersion calls are server-side rather than browser-side.
- DOM resource inspection also returned `clientYouVersionResources: []`.

## Attribution

YouVersion's developer documentation says Bible text display must include the
Bible Version copyright attribution:
`https://developers.youversion.com/sdks/javascript/guides/copyright-and-attribution`.

The implementation fetches version metadata server-side, fails closed when the
copyright field is missing, and renders the copyright plus publisher link below
the passage panel. The local server-fetch shim returned:

- `NIV · New International Version`
- `Mock NIV copyright attribution for local server-side smoke.`

## Result

Partial pass.

The UI path, optional config guard, active-citation sync, promo-hide behavior,
mobile layout, server-rendered passage panel, attribution rendering, and
absence of browser-side YouVersion requests were verified. Live YouVersion API
content and live copyright attribution were not verified because no real
`YOUVERSION_APP_KEY` was available.

## Release Blocker

Before marking this ready for release, configure a real YouVersion Platform app
key in a prod-like web environment and repeat the desktop/mobile smoke to prove
live passage text and live copyright attribution render successfully.

Tracked follow-up: `todos/006-pending-p1-youversion-app-key-smoke.md`.
