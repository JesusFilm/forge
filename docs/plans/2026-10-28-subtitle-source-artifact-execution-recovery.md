# Subtitle source artifact execution recovery

Scope: PR #886 useful execution recovered onto current main. Parent integration
plan: `2026-10-28-manager-automation-pr-recovery.md`; root owns that plan and
shipping. Roadmap: feat-892. Historical PR886 todo 016 is prototype evidence,
not an instruction to move canonical publication/state ownership into Mastra.

## Contract

`runSubtitleSource({ assetId, sourceLanguage, source }, deps?)` executes source
acquisition and writes `transcript.json` and `subtitles.vtt` under the Manager
asset ID. Source variants are `transcript_artifact`, `subtitle_artifact`, and
`mux` (explicit Mux asset ID). The function returns validated transcript content
for Mastra orchestration plus a compact summary with language, segment count,
source kind and exact artifact keys. Reads remain asset-scoped; callers cannot
choose arbitrary storage keys or outbound URLs.

`runSubtitleEnrichmentWorkflow` accepts optional `source`. Omitting it preserves
the existing translation-only API. Supplying it executes source acquisition
before invoking the existing `runSubtitleEnrichment` translation runtime. The
success/failure response can include the compact `source` summary so Manager
retains artifacts even when later translation fails.

## Work and review

1. Capture red source-only request/invalid transcript characterization.
2. Implement bounded source reuse/Mux acquisition with schema validation,
   timeouts, redirect rejection, language checks and safe failure messages.
3. Extend the workflow and Manager client without changing callback admission,
   durable run ownership, automation persistence or Mux publication.
4. Test actual local artifact writes and deterministic provider execution;
   test failures before success reporting. Run scope checks and commit with
   hooks. Root reviews exact commit and owns integrated smoke and CI.

## Durable learning

A callback-only success is not execution proof. Source success requires
validated timed segments and durable artifacts; translation success requires
per-language artifact keys. Keep publication separate so a failed Mux sync
does not discard successful source or translated artifacts.

## PR886 review repair, round 2

Scope: start from graph-integrated `7d281c435`; repair only source acquisition
and invalid approved VTT classification. Preserve the public source API and
graph provider-ambiguity tracking. No Admin, graph, callback or parent-worktree
edits, paid/provider calls, pushes, merges or deployments.

1. Reproduce uploaded preparing tracks in supported English and unsupported
   Arabic, then ready, with local fake Mux responses and zero generation POSTs.
2. Reproduce malformed VTT as `source_invalid`, `retryable: false` directly and
   through the source-only HTTP route. Keep storage/network read errors
   `source_failed`, `retryable: true`.
3. Keep bounded polling, exact language/status matching, service auth and
   signed playback. Check the existing policy pin; regenerate both services'
   literals only if the ordered pinned runtime files change.
4. Run source/translation, Manager caller and graph regression tests, both
   package typechecks/linters, formatting and enabled commit hooks. Record
   durable findings and return the isolated clean commit for parent review.
