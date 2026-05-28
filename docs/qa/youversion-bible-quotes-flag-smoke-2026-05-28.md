---
title: YouVersion Bible Quotes LaunchDarkly Flag Smoke
captured_at: 2026-05-28
branch: feat/web-youversion-bible-quotes-embed
target_url: http://127.0.0.1:3000/watch/the-vine-and-the-branches.html/english.html
status: pass-local-flag-off-on
---

# YouVersion Bible Quotes LaunchDarkly Flag Smoke

## Scope

Verify that LaunchDarkly flag `forge.watch.youVersionBibleQuotes` gates the
server-rendered YouVersion passage panel below the watch-page Bible Quotes
carousel, and that the default/off state preserves existing carousel behavior.

## Environment

- Web server: `http://127.0.0.1:3000`
- Admin GraphQL: `https://admin.jesusfilm.org/api/graphql`
- `LAUNCHDARKLY_SDK_KEY=` forced empty for local fallback validation.
- Off smoke: `FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT=false`
- On smoke: `FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT=true`
- YouVersion key source: local `apps/web/.env` server secret.

## Evidence

- Off screenshot:
  `output/playwright/youversion-flag-off-desktop.png`
- On desktop screenshot:
  `output/playwright/youversion-flag-on-desktop.png`
- On mobile screenshot:
  `output/playwright/youversion-flag-on-mobile.png`

### Default Off

- Bible Quotes section rendered.
- Quote cards rendered: `2`
- Promo slide rendered.
- YouVersion panel absent.
- Browser request inspection captured no `api.youversion.com` requests.

### Enabled

- Bible Quotes section rendered.
- Quote cards rendered: `2`
- Promo slide rendered.
- YouVersion panel rendered on desktop and mobile.
- Initial panel reference: `JHN.15.13`
- Initial panel version: `data-version-id="3034"`
- Initial panel content:
  `Greater love has no one than this, that he lay down his life for his friends.`
- Attribution rendered: `BSB · Berean Standard Bible`, `Public Domain`
- Browser request inspection captured no `api.youversion.com` requests.

## Notes

The first local attempt used a local admin dev server on port `3033`, but that
backend returned an admin GraphQL resolver error for the smoke slug. The final
smoke used production admin GraphQL, matching the earlier live-key YouVersion
smoke path.
