---
module: Studio authoring
problem_type: ui_bug
tags: [studio, framing, source-identity, subtitles, mcp]
---

# Source framing and subtitle eligibility are separate from layer placement

Studio search previously filtered out a playable downloadable dub unless its
edition also had subtitles in the selected language. Capture and its database
FK required a track too. Removing only the search filter would expose footage
that still could not be inserted or rendered.

Represent an explicitly absent track as `trackId: null` and `source.subtitle:
null`, with nullable subtitle URL/flags. Carry that absence through snapshot
retention, document validation, materialization and publication eligibility.
Subtitle preview reports `no-subtitle` with zero cues; it does not produce new
transcripts. Captured source identity, current restrictions and retained bytes
remain mandatory. Existing populated snapshots retain their digest recipe.

A canvas transform moves the already cover-fitted video element; canvas crop
clips that element. Neither reaches the discarded part of the source. A video
`focus` uses CSS `object-position` inside cover fitting, in both HLS preview and
OffthreadVideo export. Its default is centre; `set-source-focus` changes only
that field, preserving source trims, timing, music and overlays.

Instruction inspection has separate consent scope and signed native storage
access. Keep its availability independent of hosted execution enablement and
admission-secret configuration. Execution, mutations and calendar operations
remain gated. Expected missing snapshots, invalid input and denied access should
cross the delegated error boundary as bounded typed failures; unknown exceptions
must not expose internal messages.

## Verification evidence

Based on `main` commit `2e914c52a` on 2026-10-06. Restoring main's search filter
makes the real-database LUMO-shaped test return no results; restoring main's
renderer fails the left-focus preview/export assertion. Both pass with the fix.
The database fixture covers source capture/read, no-subtitle preview, source
trimming, revision insertion, deletion retention and current restriction changes.
Existing subtitle and catalog-publication tests also pass against a fresh local
Postgres database with all migrations through `0128`.

A real signed instruction read with native Postgres storage passes without an
execution admission secret, rejects unsigned/missing-scope callers and never
claims execution. Manager MCP/editor and portable archive tests pass. Package
typechecks and touched-file lint pass.

A minified production bundle comparison uses the same entrypoints and dependency
resolution for main and the worktree. Preview, Inspector and Library keep their
input module counts; the final measurement adds respectively 90, 129 and 76 gzip
bytes. This measures download impact, not production Web Vitals. No media fetch,
buffering or initialization path was added by the source-focus setting.

Production catalog availability for `6_GOLuke2611` and `6_GOLuke2616`, and the
colleague's exact MCP failures, require a production client replay. Follow-up
`feat-608` records this separately from local implementation evidence.
