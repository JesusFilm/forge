---
id: "feat-275"
title: "Admin Editor Video Picker Language-Aware Dubs"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on:
  - "feat-274"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "editor"
---

## Problem

The admin experience editor video picker hydrates each video with a single
`previewStreamUrl` chosen from the first playable dub in the fetched dub list.
That is wrong for clip authoring: start and end timestamps can differ by dub,
and an editor working in a localized experience should first see a playable dub
for that experience language when one exists.

## Entry Points

1. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
2. `apps/admin/src/app/dashboard/live-data.ts`
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
5. `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`

## What To Build

1. Hydrate video-library rows with playable dub options, including language
   slug/BCP-47, label, stream URL, and dub-specific duration.
2. Prefer the active experience locale's matching playable dub when opening the
   picker.
3. Add a language dropdown so editors can intentionally choose a different dub
   before trimming.
4. Make preview, duration, clip bounds, and saved `streamingUrl` follow the
   selected dub.

## Constraints

- Do not change public Watch behavior.
- Do not change Admin GraphQL schema unless persistence requires it.
- Preserve existing server-side picker search behavior from `feat-274`.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx`
- `pnpm --filter @forge/admin typecheck`
