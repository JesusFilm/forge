---
date: 2026-04-11
topic: manager-transcript-stage-drift
---

# Manager Transcript Stage Drift

## What We're Building

We need to decide whether Forge should keep, remove, or actually implement the legacy manager step names `structured_transcript` and `subtitle_post_process`.

Current repo evidence says those names are UI/type vocabulary drift, not live workflow behavior. The live CMS schema and generated GraphQL enum only support `transcription`, `translation`, `chapters`, `metadata`, `embeddings`, and `mux_upload`. The workflow runner also marks only those steps. The two legacy names still appear in manager UI copy and the imported `WorkflowStepName` union, which makes the operator experience imply a Loom-style normalized transcript pass that does not exist.

## Why This Approach

The most honest path is to treat this as a product-truth problem before it becomes an implementation problem.

Repo history strongly suggests the stale names arrived during the March 19, 2026 "restore original VideoForge UI" import, not during the original Forge manager pipeline port. Since then, transcript-related work has continued in other directions: split-brain subtitle translation, Mux subtitle sync, transcript-aware embeddings, and scene-embedding sync. None of those branches introduce a real `structured_transcript` or `subtitle_post_process` runtime stage.

That means we should choose deliberately between:

1. removing stale operator-facing language,
2. keeping it as explicit legacy vocabulary,
3. or reviving the concept as a real workflow stage with acceptance criteria.

YAGNI points to cleanup unless product genuinely wants those stages to exist.

## Key Decisions

- Treat `structured_transcript` and `subtitle_post_process` as stale imported vocabulary unless a new feature explicitly revives them: current runtime, CMS schema, and roadmap docs do not implement or describe them.
- Prefer truthful operator copy over upstream parity: imported VideoForge step names should not imply work that Forge never runs.
- If normalized transcript output is needed later, model it around real artifacts and acceptance criteria instead of reusing legacy names automatically.
- Use `codex/remove-legacy-cms-notify` as precedent: adjacent stale workflow vocabulary is already being pruned in a local branch.
- Keep adjacent compatibility shims only where they still help old jobs render, such as legacy artifact aliases, and remove them separately from step-name truthfulness.

## Resolved Questions

- Were these stages ever part of the live Forge workflow? No. Current workflow/state/schema evidence says no.
- Do unmerged local branches contain a hidden implementation of these stages? No. They contain richer subtitle, Mux sync, and embedding work, but not these step names as runtime stages.
- Did the names come from the original Forge port? No. They appear with the later UI restoration commit that copied upstream VideoForge vocabulary.

## Open Questions

None.

## Next Steps

Recommended next move: plan a narrow cleanup that removes the stale step names and misleading UI copy while preserving any artifact backward-compatibility that still matters for older jobs.

Alternative if product wants more visibility: plan a real normalized-transcript feature with explicit inputs, outputs, QA rules, and whether it should live under `transcription`, `translation`, or a new truthful step name.
