# Manager enrichment graph recovery unit

This unit follows `2026-10-28-manager-automation-pr-recovery.md` and the existing
PR1087 audit. It integrates admission commit `eb2b6e5` onto `a810975c7`, then
replaces the registered fail-only workflow. Root owns feat-908 tracking, Admin
schema/generated clients, integration and independent review. No new IDs are
allocated here.

## Scope and implementation

The committed `forge-video-enrichment` workflow executes
`apps/mastra/src/services/video-enrichment/graph.ts`:

1. Optional Manager audio cleanup, otherwise a skipped callback.
2. Existing `runSubtitleSource` for an explicitly requested language, using a
   declared stored transcript/VTT when present, otherwise the actual Mux source.
3. Existing scripture-correction judgment, Manager exact-match application and
   rereading of the corrected canonical artifact.
4. Parallel existing subtitle translation, local chapter/metadata services, and
   existing transcript embeddings. The leaf subtitle runtime retains its own
   language concurrency and sequential chunk execution. All branches settle
   before aggregate failure or publication.
5. Manager Mux publication, which persists its report before comparison failure.
6. Optional scene analysis, isolated for definitively settled failures. No scene
   embedding path is restored.
7. Terminal callback only after every claimed stage has definitively completed.

Chapter, metadata, scene-boundary and scene-analysis prompts, models and
normalization were ported locally from the current Manager services, with their
behavior tests. Runtime imports never cross app contexts. Shared local artifact
storage and service HTTP contracts retain the existing ownership boundaries.

## Operation fencing

The fixed bridge operations add `mastra-stage-claim` and
`mastra-stage-complete`, each carrying a fixed stage and SHA-256 `stageDigest`.
The stage digest binds the actual stage arguments, including corrected transcript
content for translation. Translation reads the captured canonical transcript,
not a later mutable reread. Admin uses `operationId = mastra:<stage>` and
`operationDigest = stageDigest`, alongside the immutable admitted run digest.
Claim returns a token; completion supplies that token and a bounded
`{status: completed | failed}` receipt. Completion must return `status: replayed`.
Both completion and claim check current ownership. Concurrent different stages
are allowed; every in-flight claim blocks ownership transfer and terminal writes.

A thrown generic provider/transport exception is not a settled-failure receipt.
Stage-local async context detects transport failures even when an advisory leaf
converts them into fallback output, prevents a subsequent provider request in
that stage, and retains the consumed claim. The graph waits for other branches
but withholds terminal status. Manual reconciliation is required before another
run. A completed-stage replay never grants a new spending token; this unit
refuses automatic same-run graph reconstruction instead of repeating work.

## Validation and limits

Deterministic tests execute the committed Mastra graph with real local artifact
writes, production leaf services, local HTTP callback/bridge clients and injected
provider responses. They cover partial/all-language failure, branch settlement,
Mux report-before-failure, optional scene failure, cleanup failure, ownership
loss before later spend, swallowed timeouts and dropped callbacks. Manager tests
cover stage tokens, immutable stage binding, replay without spend, and stale
completion. Existing admission, callback security and redispatch suites remain.

These are not paid-provider or production ingress proofs. The local HTTP ledger
and callback projection are deterministic adapters, not the actual Admin database
or deployed Manager route. Root integration must exercise that end-to-end durable
path and review the final integrated commits. Engine flags remain default-off;
Mastra migration 005 and Admin's operation ledger must be installed before use.

Explicit ElevenLabs transcription remains on the legacy Manager engine; the
Mastra graph fails such requests honestly before spend. The frozen source API
requires an explicit source language, so `auto` also fails before spend. Audio
cleanup produces review artifacts before source execution; Mux source acquisition
does not transcribe the cleaned audio. Scene analysis uses the supplied Mux
playback ID or resolves it from the same Mux asset when absent.
Recovery reuses declared source artifacts only through the existing parser; it
does not bypass missing/corrupt artifact validation. Automatic reconciliation,
inter-progress recovery, live throughput disposition and deployment are outside
this unit. No push, PR merge or deployment was performed.
