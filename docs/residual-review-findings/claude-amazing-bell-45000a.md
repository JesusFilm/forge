# Residual Review Findings

Source: `ce-code-review mode:autofix` on the Instagram discovery commentary
exclusion filter (plan `docs/plans/2026-06-11-002-feat-instagram-discovery-exclusion-filter-plan.md`),
branch `claude/amazing-bell-45000a`.

Most review findings were applied as autofixes (removed false-positive-prone
keywords `according to` / `mocking` / `explains`, made `excludedCommentary`
count accurate past the `maxResults` cap, added guard tests). One non-blocking
finding is deferred:

- **P2 (downstream-resolver)** `apps/mastra/src/services/instagram-discovery/types.ts` — `matchedCommentary` is computed in `MatchSignals` but not surfaced on `InstagramPost` or in the report. Operators can see _how many_ posts were excluded as commentary (`totals.excludedCommentary`) but not _which keywords_ triggered an exclusion, and excluded posts are not in the output at all. If the keyword filter remains the primary exclusion mechanism (before the deferred LLM relevance check lands), consider adding an optional "excluded" sample/log surface so false-positive exclusions are auditable. Deferred to avoid scope creep on the exclusion-filter-first change.
