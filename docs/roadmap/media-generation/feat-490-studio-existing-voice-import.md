---
id: "feat-490"
title: "Import existing ElevenLabs voices into Studio"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-12"
duration: 1
depends_on:
  - "feat-458"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Peace in the Storm revision 9 has six cards without speech and no available voice
preset. The speech panel instructs operators to import a known preset but exposes
only voice-design experiments. Existing ElevenLabs voices cannot be selected.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/production-panel.tsx`
2. `apps/manager/src/app/api/shorts/voices/route.ts`
3. `apps/manager/src/services/studio-production/existing-voices.ts`
4. `packages/studio-contracts/src/assets.ts`

## Grep These

- `No matching recorded voice|studioVoicePresetSchema|asset-upload`

## What To Build

Search existing provider voices and import a verified preset through the existing
interactive asset registry. Record author language separately from the explicit
provider language code. Expose the imported preset immediately in speech review.

## Constraints

No provider generation or voice creation during search/import. Preserve interactive
authentication, bounded responses, retained immutable identity, script approval and
paid narration admission. Keep API keys on the server. No GraphQL changes.

## Verification

Route/service tests cover authentication, provider rejection, metadata identity,
language mapping, bounded responses and transfer capabilities. Check Manager types,
lint, build and browser import flow. Verify unchanged editor startup loading.

## Completed

Implementation and validation: `docs/solutions/integration-issues/studio-existing-voice-import.md`.
Existing project narration/render verification continues under feat-458.
