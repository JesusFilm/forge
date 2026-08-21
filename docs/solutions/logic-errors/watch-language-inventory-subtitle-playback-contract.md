---
title: "Watch language inventory subtitle cards need edition-compatible playback"
date: "2026-08-21"
category: "logic-errors"
module: "Watch language inventory"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "A subtitle-only language inventory card opened playable audio but did not activate the subtitle promised by the card"
  - "A Video with several editions could fall back to a Dub whose edition did not own the requested VTT"
  - "SRT-only or blank subtitle rows could be counted even though the Web player consumes VTT"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/admin Watch language inventory"
  - "apps/web Watch language inventory routing"
  - "Watch subtitle playback"
tags:
  - "watch"
  - "language-inventory"
  - "subtitles"
  - "video-edition"
  - "language-routing"
  - "webvtt"
  - "postgres"
  - "multilingual"
---

# Watch language inventory subtitle cards need edition-compatible playback

## Problem

The Watch language inventory could label a Video as available through subtitles
and then open audio from a different Video Edition. The route was playable, but
the requested subtitle was not available on the edition selected by that Dub.

## Symptoms

- A card in a language's subtitle-only section opened a Video without enabling
  that language's subtitle.
- The failure was content-dependent: Videos with one compatible edition worked,
  while Videos whose fallback audio belonged to another edition did not.
- A subtitle query parameter alone could not repair the mismatch because the
  player can only select tracks owned by the active Dub's Video Edition.

## What Didn't Work

- Selecting any published fallback Dub for the Video was too broad. A Dub can be
  playable while pointing at an edition that does not own the requested VTT.
- Carrying only the inventory language in the public path was incorrect because
  Watch path language segments represent playable audio, not subtitle-only
  availability.
- Treating SRT as equivalent to VTT overstated availability. The Web player uses
  VTT for its browser text track.

## Solution

Admin now constructs subtitle-only inventory candidates from a complete
playback tuple. A candidate requires a nonblank VTT, valid subtitle ownership,
and a published HLS Dub on the same Video Edition. The selected audio language
and duration travel with that candidate instead of being recomputed later
(`apps/admin/src/services/video.service.ts:2167-2210`,
`apps/admin/src/services/video.service.ts:2501-2515`).

Fallback selection stays deterministic within the compatible edition. It
prefers the Video's primary audio language, then English, then duration,
language slug, and stable Dub ID (`apps/admin/src/services/video.service.ts:2201-2210`).

Web keeps those two language roles separate. The public path uses the playable
audio slug returned by Admin. Only a `SUBTITLE_ONLY` card adds the inventory
language as one-shot `?subtitles=` intent; normal audio cards keep their existing
URLs (`apps/web/src/lib/watch-language-inventory.ts:361-381`,
`apps/web/src/lib/routes.ts:120-128`).

The real-PostgreSQL regression fixture covers same-edition selection, direct
subtitle ownership, SRT-only rows, blank VTTs, missing same-edition audio, and
deterministic primary-language preference. That fixture runs in the existing
Admin PostgreSQL CI step.

## Why This Works

A Dub selects the playable audio and points to one Video Edition. That edition
owns the subtitle tracks. Choosing both from the same tuple guarantees that a
card advertising a subtitle can open audio that actually exposes that subtitle.

The URL continues to model the same boundary: its path names playable audio,
while its bounded query parameter carries the viewer's one-shot subtitle intent.
This avoids inventing an audio route for a subtitle-only language and leaves
fully dubbed inventory routes unchanged.

## Prevention

- Treat Video Edition plus subtitle ownership as the synchronization boundary
  whenever subtitle availability is paired with fallback audio.
- Do not select fallback audio in a later hydration step without preserving the
  edition that made the subtitle eligible.
- Count only the subtitle format the Web player can consume, and keep raw
  non-null/non-empty predicates alongside normalized blank checks when existing
  partial indexes depend on their shape.
- Pair SQL-shape tests with a real-PostgreSQL fixture. Mocked rows cannot prove
  edition joins, ownership guards, or partial-index-compatible predicates.

## Related Issues

- [Watch search subtitle playback contract](./watch-search-subtitle-playback-contract.md)
- [Watch language inventory candidate-first SQL](../performance-issues/watch-language-inventory-candidate-first-sql-20260713.md)
- [Watch subtitle VTT delivery](../ui-bugs/watch-subtitle-vtt-proxy-account-gate.md)
- [Watch language inventory subtitle intent](../../roadmap/content-discovery/feat-403-watch-language-inventory-subtitle-intent.md)
- [Watch language inventory subtitle watchability](../../roadmap/content-discovery/feat-404-watch-language-inventory-subtitle-watchability.md)
