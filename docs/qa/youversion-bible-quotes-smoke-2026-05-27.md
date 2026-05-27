---
title: YouVersion Bible Quotes Embed — Smoke Report
captured_at: 2026-05-27
verified_at: 2026-05-27
branch: feat/web-youversion-bible-quotes-embed
target_url: http://127.0.0.1:3000/watch/1-jesus-our-loving-pursuer/english
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
- YouVersion smoke key: `local-smoke-app-key`, intentionally fake, used only to
  verify the guarded SDK render and network path.

## Evidence

- Desktop screenshot:
  `output/playwright/youversion-bible-quotes-desktop.png`
- Mobile screenshot:
  `output/playwright/youversion-bible-quotes-mobile.png`
- URL rendered 3 Bible quote cards and the always-on promo slide.
- Initial panel reference:
  `LUK.8.2`
- After selecting the second quote, panel reference:
  `LUK.16.9`
- After selecting the promo slide, the panel was hidden.
- Mobile viewport smoke used `390x844` and rendered the Bible Quotes header,
  3 quote cards, promo slide, and YouVersion panel.
- Browser console after smoke contained React DevTools/HMR development
  messages and an existing Next.js LCP image warning for
  `/watch/images/jesusfilm-sign.svg`.
- Network showed requests to:
  `https://api.youversion.com/v1/bibles/111/passages/LUK.8.2...`
  and
  `https://api.youversion.com/v1/bibles/111/passages/LUK.16.9...`
- Network also showed version metadata requests to:
  `https://api.youversion.com/v1/bibles/111`

## Attribution

YouVersion's developer documentation says Bible text display must include the
Bible Version copyright attribution:
`https://developers.youversion.com/sdks/javascript/guides/copyright-and-attribution`.

The implementation fetches version metadata with the YouVersion React hook and
renders `version.copyright` below `BibleTextView` when the SDK returns it. This
was unit-tested with the SDK hook mocked; live copyright rendering still needs
the real-key smoke below.

## Result

Partial pass.

The UI path, optional config guard, active-citation sync, promo-hide behavior,
mobile layout, and YouVersion request path were verified. Live passage content
and live copyright attribution were not verified because no real
`NEXT_PUBLIC_YOUVERSION_APP_KEY` was available.

## Release Blocker

Before marking this ready for release, configure a real YouVersion Platform app
key in a prod-like web environment and repeat the desktop/mobile smoke to prove
live passage text and live copyright attribution render successfully.

Tracked follow-up: `todos/006-pending-p1-youversion-app-key-smoke.md`.
