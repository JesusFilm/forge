---
id: "feat-322"
title: "Watch dynamic audio-language admission"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-30"
duration: 1
depends_on:
  - "feat-149"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "routing"
  - "languages"
---

## Problem

Forge Web rejects playable audio languages that were added after Web's static
`PUBLIC_WATCH_LANGUAGE_SLUGS` snapshot. Jiamao is present in Core and Forge
Admin with a published HLS dub, but `/watch/jesus.html/jiamao.html` rewrites to
404 before the proxy consults Admin's current Watch route manifest.

## What To Build

1. Keep the static language corpus as the one-segment collision and canonical
   English URL authority.
2. Treat a safe language-slug shape plus an exact dynamic route-manifest match
   as sufficient admission for video and episode language slots.
3. Allow Admin-sourced language metadata to retain safe slugs even when they
   are absent from the static BCP-47 snapshot.
4. Route newly discovered one-segment language selections to their admitted
   language inventory until they join the static language-home corpus.
5. Cover Jiamao-shaped dynamic language admission across proxy, page routing,
   search language projection, and language inventory.

## Constraints

- Unknown and malformed routes still fail closed.
- BCP-47 catalog keys remain invalid public audio-language URL identities unless
  Admin's manifest explicitly publishes that exact slug.
- Do not add request-time GraphQL work to page rendering.
- Do not hand-add Jiamao to generated static corpora as the primary fix.

## Verification

- Focused proxy, catch-all routing, search-language, language-switcher, and
  language-inventory route tests.
- Web typecheck and lint.
- Production URL probe after normal PR-to-main deployment.

## Completion Notes

- Two- and three-segment audio-language slots now accept safe slug syntax and
  defer exact existence checks to the Admin-owned runtime route manifest.
- The static language corpus remains authoritative only where runtime data is
  unavailable: one-segment collision and canonical-English URL construction.
- Admin-projected Jiamao metadata remains routable with `bcp47=null`; raw
  BCP-47 catalog keys remain rejected as public audio identities.
- Dynamic language-home selections redirect to the manifest-admitted language
  inventory instead of entering the ambiguous one-segment catch-all.
- Full Web tests, typecheck, and lint pass. Production probing remains a
  post-deploy check under the repository's normal PR-to-main policy.
