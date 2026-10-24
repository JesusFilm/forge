---
id: "feat-696"
title: "Normalize percent-escape case from the public Watch reverse proxy"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-13"
duration: 1
depends_on: []
blocks: []
tags: [web, routing, unicode]
---

## Problem

FGE-127/PR #2662 deployed at `1adbb8f6c75be4dd8a8dc1c0d560f5049e8c6f40`. All five published Unicode titles render and play at the Railway origin, but canonical `www.jesusfilm.org` renders Page not found.

The deployed Core reverse proxy lowercases percent-escape triplets before constructing its upstream Request. This changes UTF8 escape spelling: `%C3%A7` becomes `%c3%a7`. Source: [Core worker at deployed commit](https://github.com/JesusFilm/core/blob/3eea368262bc3426233c472013df4201a9f5adf6/workers/jf-proxy/src/index.ts#L121); [normal successful worker deployment](https://github.com/JesusFilm/core/actions/runs/38475420213/job/115565436549). That commit's `workers/jf-proxy/wrangler.toml` routes `www.jesusfilm.org/watch*` to the same Railway origin.

Read-only probes preserving the actual request target (`curl --path-as-is --request-target`) reproduce the boundary: Mostly Tea/Tümlükden Nura uppercase escapes render correct pages at origin; lowercase escapes render Page not found and rewrite to `/watch/en/en/404`. Canonical URLs fail for either spelling because the worker lowercases the escape triplets in both. `apps/web/src/proxy.ts::isSafeCanonicalPath` compares `encodeURI(decodeURI(pathname))` with the original pathname and therefore rejects equivalent lowercase escape bytes.

An initial decoded-NextURL hypothesis was rejected during independent review: WHATWG NextRequest parsing already encodes decoded UTF8, and forced raw pathname tests did not reproduce the actual boundary. That experimental normalization was replaced, never published or deployed.

## Scope and verification

- Normalize only valid `%HH` hexadecimal triplet case before existing proxy admission. Do not lowercase characters, decode early, admit ASCII escape aliases or modify the worker.
- Preserve exact decoding round-trip, lowercase Latin content grammar, language rules and published manifest/English-audio admission.
- Actual `NextRequest` tests for all five direct/contextual URLs: upstream lowercase escapes match canonical rewrites and ASCII-safe internal headers. Existing/new unsafe encoding tests keep separators, controls, malformed escapes, `%6A` ASCII aliases, double escaping, NFD and encoded traversal rejected.
- Reverting normalization must fail all five new title tests. Run proxy/URL routing tests, typecheck, scoped lint/format and live hooks.
- Server proxy code only: no client bundle, fetch, rendering or initialization change; no loading performance claim.
- After owner-approved normal merge/deploy, validate canonical direct/contextual pages, search links and full-player time advancement. Keep FGE-127/FGE-80 open until public verification passes.
