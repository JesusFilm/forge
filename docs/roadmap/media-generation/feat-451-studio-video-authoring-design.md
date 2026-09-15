---
id: "feat-451"
title: "Studio video authoring design"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-07"
duration: 1
depends_on: []
blocks:
  - "feat-452"
  - "feat-453"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

The design interview established a replacement for Studio Shorts, using Lyuba's
devotional work as its initial creative workflow. Capture the decisions and
canonical vocabulary before implementation planning.

## Entry Points — Read These First

1. `docs/brainstorms/2026-09-07-studio-video-authoring-brief.md` — interview decisions and remaining engineering investigations.
2. `docs/research/devotional-editor-feasibility.md` — verified Mastra, Remotion, and concurrency capabilities.
3. `CONCEPTS.md` — Content Pack vocabulary.
4. `apps/manager/src/features/shorts/` — existing product surface being replaced.

## Grep These

- `Content Pack|content pack`
- `expectedDraftRevision|shorts-draft-v1`

## What To Build

Consolidate the design brief, record the accepted Content Pack term, and obtain
confirmation of shared understanding. Implementation planning follows that
checkpoint; this ticket does not deliver the editor.

## Constraints

- Documentation only during the interview.
- Do not reinstate rejected assumptions: Admin-hosted UI, fixed devotional
  structure, autonomous script/audio generation from calendar planning,
  translated releases, or corrections to published items.
- No legacy Shorts migration is required; user reports no existing content to preserve.

## Verification

- Compare the brief with the interview's latest decisions.
- Format-check the changed Markdown.
- Mark complete after the user confirms the consolidated design.

## Outcome

The user confirmed shared understanding and authorized implementation planning on
2026-09-07. The confirmed brief and `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md`
record the result. Implementation is tracked separately in feat-452 through feat-462.
