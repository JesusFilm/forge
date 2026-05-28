---
status: pending
priority: p1
issue_id: "006"
title: YouVersion Bible Quotes embed needs prod-like real app-key smoke before release
labels:
  - web
  - watch
  - third-party-api
  - verification
created_at: 2026-05-27
---

# Problem

The watch-page Bible Quotes YouVersion embed now fetches passage data
server-side using `YOUVERSION_APP_KEY`. Local live-key smoke passed after the
key was added to `apps/web/.env`, but release readiness still needs a
prod-like environment smoke because Railway production/PR preview access was
not available from the current CLI token/session.

# Why It Matters

Local validation now verifies the no-key fallback, active-citation wiring,
server-rendered passage panel, live YouVersion passage text, copyright
attribution, and absence of browser-side YouVersion requests. A prod-like smoke
is still required to prove the deployed `@forge/web` environment has the same
secret/config shape and does not depend on local-only overrides.

# Evidence

- URL tested locally:
  `http://127.0.0.1:3000/watch/the-vine-and-the-branches/english`
- Live API diagnosis showed version `111` returns version metadata but passage
  reads fail with `403 "Access denied for 111"` for this app key.
- The PR default was changed to `YOUVERSION_DEFAULT_VERSION_ID=3034` (BSB);
  live local smoke rendered `JHN.15.13`, `data-version-id="3034"`, BSB
  attribution, and no browser-side YouVersion requests.
- Screenshots captured during the live-key smoke:
  - `output/playwright/youversion-local-3034-desktop.png`
  - `output/playwright/youversion-local-3034-mobile.png`

# Proposed Fix

1. Ensure `YOUVERSION_APP_KEY` is present in the appropriate web preview and
   production secret stores.
2. Ensure deployed web environments either use the code default
   `YOUVERSION_DEFAULT_VERSION_ID=3034` or explicitly set an authorized
   version ID.
3. Re-run the watch-page browser smoke in a prod-like environment and verify:
   - first Bible quote renders live YouVersion passage content
   - selecting another citation updates the YouVersion reference
   - selecting the promo slide hides the panel
   - mobile and desktop layouts remain readable
   - no new browser console errors are introduced
   - browser network still does not expose `api.youversion.com` requests

# Acceptance Criteria

- A prod-like web environment has a real YouVersion Platform app key.
- The watch page renders live YouVersion passage text below Bible Quotes.
- PR/release notes mention only the secret source/environment, not the key.
