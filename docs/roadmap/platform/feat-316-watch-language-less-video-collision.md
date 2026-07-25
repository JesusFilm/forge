---
id: "feat-316"
title: "Resolve Watch language-less Video and Experience collisions"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-25"
duration: 1
depends_on:
  - "feat-315"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "production"
---

## Problem

Production validation of `feat-315` showed that `/watch/jesus.html` still
rewrote to `/watch/en/en/jesus.html` and rendered the fixed 404. The live route
manifest admits `jesus` as both a published one-segment Experience and a
standalone Video, so the proxy returns on the Experience admission before it
evaluates the exact English Video route.

## What To Build

1. For a one-segment slug with an exact content/audio manifest entry, prefer
   the admitted English standalone Video.
2. Preserve one-segment Experience behavior when no exact content/audio entry
   exists, including `/watch/easter.html`.
3. Preserve compatibility with older manifests that do not contain exact
   content/audio indexes by keeping one-segment admission first in that case.
4. Keep unknown, non-English-only, and manifest-unavailable routes closed.

## Verification

- Add a proxy regression fixture where `jesus` appears in both
  `oneSegmentSlugs` and the exact English content/audio index.
- Retain the one-segment collection, no-English, and missing-manifest tests.
- Run the focused proxy suite, Web typecheck, lint, and production URL matrix.
