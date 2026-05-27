---
status: pending
priority: p1
issue_id: "006"
title: YouVersion Bible Quotes embed needs real app-key smoke before release
labels:
  - web
  - watch
  - third-party-api
  - verification
created_at: 2026-05-27
---

# Problem

The watch-page Bible Quotes YouVersion embed now fetches passage data
server-side using `YOUVERSION_APP_KEY`, but the local Forge web dev secrets
checked during implementation did not include that key. Browser smoke used a
clearly fake local key plus a temporary server-side fetch shim to verify that
the browser receives rendered passage text and never sends YouVersion requests
itself, but this still does not validate live scripture content from
YouVersion.

# Why It Matters

This PR can verify the no-key fallback, the active-citation wiring, the
server-rendered passage panel, and absence of browser-side YouVersion requests,
but release readiness requires a real YouVersion Platform app key in
preview/prod-like config and one browser smoke that proves the embed renders
live passage text.

# Evidence

- URL tested locally:
  `http://127.0.0.1:3000/watch/the-vine-and-the-branches/english`
- Local and Doppler dev checks reported no configured `YOUVERSION_APP_KEY`.
- Browser network evidence showed no `youversion` requests; local server-side
  smoke used `/private/tmp/mock-youversion-fetch.mjs` to return deterministic
  YouVersion-shaped responses inside the Node dev server.
- Screenshots captured during the fake-key smoke:
  - `output/playwright/youversion-bible-quotes-server-desktop.png`
  - `output/playwright/youversion-bible-quotes-server-mobile.png`

# Proposed Fix

1. Add `YOUVERSION_APP_KEY` to the appropriate web preview and production
   secret stores.
2. Decide whether `YOUVERSION_DEFAULT_VERSION_ID=111` is the
   desired default version for launch.
3. Re-run the watch-page browser smoke with the real key and verify:
   - first Bible quote renders live YouVersion passage content
   - selecting another citation updates the YouVersion reference
   - selecting the promo slide hides the panel
   - mobile and desktop layouts remain readable
   - no browser console errors remain
   - browser network still does not expose `api.youversion.com` requests

# Acceptance Criteria

- A prod-like web environment has a real YouVersion Platform app key.
- The watch page renders live YouVersion passage text below Bible Quotes.
- PR/release notes mention only the secret source/environment, not the key.
