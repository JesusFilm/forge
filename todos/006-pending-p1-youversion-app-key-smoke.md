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

The watch-page Bible Quotes YouVersion embed is guarded behind
`NEXT_PUBLIC_YOUVERSION_APP_KEY`, but the local Forge web dev secrets checked
during implementation did not include that key. Browser smoke used a clearly
fake local key to verify that the section renders the SDK panel and issues
YouVersion passage requests, but the SDK correctly rendered its API failure
state instead of live scripture content.

# Why It Matters

This PR can verify the no-key fallback, the active-citation wiring, and the
request path to `api.youversion.com`, but release readiness requires a real
YouVersion Platform app key in preview/prod-like config and one browser smoke
that proves the embed renders live passage text.

# Evidence

- URL tested locally:
  `http://127.0.0.1:3000/watch/1-jesus-our-loving-pursuer/english`
- Local and Doppler dev checks reported no configured
  `NEXT_PUBLIC_YOUVERSION_APP_KEY`.
- Browser network evidence showed requests to
  `https://api.youversion.com/v1/bibles/111/passages/...`.
- Screenshots captured during the fake-key smoke:
  - `output/playwright/youversion-bible-quotes-desktop.png`
  - `output/playwright/youversion-bible-quotes-mobile.png`

# Proposed Fix

1. Add `NEXT_PUBLIC_YOUVERSION_APP_KEY` to the appropriate web preview and
   production secret stores.
2. Decide whether `NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID=111` is the
   desired default version for launch.
3. Re-run the watch-page browser smoke with the real key and verify:
   - first Bible quote renders live YouVersion passage content
   - selecting another citation updates the YouVersion reference
   - selecting the promo slide hides the panel
   - mobile and desktop layouts remain readable
   - no browser console or network errors remain

# Acceptance Criteria

- A prod-like web environment has a real YouVersion Platform app key.
- The watch page renders live YouVersion passage text below Bible Quotes.
- PR/release notes mention only the secret source/environment, not the key.
