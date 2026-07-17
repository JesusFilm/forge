---
id: "feat-204"
title: "Devotional Voices + Ambient Music Bed"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 7
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

Every devo uses one fixed Azure voice and has no music. We want voice variety
and a calm ambient bed that helps people pause and reflect.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/voiceover.ts` — Azure TTS.
2. `apps/shorts-compositions/src/devotional/DevotionalVideo.tsx` — audio mixing.

## What To Build

Curate 3–4 warm Azure neural voices; pick ONE per devo deterministically (e.g.
by date) — never change mid-devo. Add an ambient music bed mixed under the
narration with ducking (~-12 to -15 dB). Track each track's source + license.

## Constraints

One devo = one voice. Music must duck so narration stays clear. Free/royalty-free
or licensed tracks only (Pixabay / YouTube Audio Library / Incompetech CC-BY);
verify and store attribution per track. Avoid AI-generated music (license risk).

## Verification

A sample of devos use different voices but each is internally consistent; music
is audible but never competes with the voice.
