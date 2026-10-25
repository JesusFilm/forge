---
id: "feat-288"
title: "Devotional ElevenLabs Voices + Reusable Ambient Music Library"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-01"
duration: 7
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

Every devotional needs consistent voice variety and a calm ambient bed that
helps people pause and reflect without generating a new music asset on every
run.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/elevenlabs-voiceover.ts` — ElevenLabs TTS.
2. `apps/mastra/src/services/devotional/music-library.ts` — deterministic reusable track selection.
3. `apps/shorts-worker/scripts/generate-music-library.mjs` — one-time library generation.
4. `docs/plans/2026-07-10-001-feat-video-first-devotional-pipeline-plan.md` — newer owner-approved audio decision.

## Grep These

- `DEVOTIONAL_VOICES|rotateVoice` in `apps/mastra/src/services/devotional`.
- `TARGET_LIBRARY_SIZE|pickTrack` in `apps/mastra/src/services/devotional/music-library.ts`.
- `ELEVENLABS_API_KEY|ELEVENLABS_MUSIC_MODEL` in `apps/mastra/src`.

## What To Build

Use the owner-approved ElevenLabs D → E → C voice rotation, picking one voice
per devotional and never changing mid-devotional. Pre-generate a reusable
20-track ambient library once (five tracks for each supported mood), store a
manifest with prompt/model provenance, and select tracks deterministically.
Mix the selected track under narration with ducking (~-12 to -15 dB).

## Constraints

One devotional = one voice. Do not generate a fresh track for every run. Music
must duck so narration stays clear. Production generation and deployment are
contingent on explicit owner confirmation that the ElevenLabs account tier and
applicable music license permit the intended generation, storage, reuse, and
distribution. Store provenance, but do not treat provenance as legal clearance.

## Verification

The voice rotation is deterministic and each devotional is internally
consistent. The manifest contains 20 reusable, mood-tagged tracks; selection is
deterministic; rendered music is audible but never competes with narration.
Deployment remains blocked until account/license approval is recorded.
