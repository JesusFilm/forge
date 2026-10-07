# J075 RAG strategy reconciliation

## Findings and decisions

Inspected the current main baseline `565f1835b`, root/lane guidance, every RAG
feature's status/dependencies, consumer/manual/bench plans, the evaluation and
source entry points, and durable source-brand and usage-accounting lessons.
The assigned worktree was clean and was fast-forwarded to current main before
allocating IDs. No application files or production state were changed.

- The October 5 suggestions are supplied by the job brief; no transcript was
  located or independently verified. They are captured as unapproved categories.
- Latest October 6 records complete feat-610 under owner acceptance with explicit
  unperformed checks. Feat-532 remains in progress for legacy resource retirement.
  J075 preserves those distinctions and all existing delivery statuses.
- Source Expansion uses a metadata-only intake, evidence-backed rights decisions,
  explicit approval transitions, bounded pilots, quality gates and incident follow-up.
  Public availability and an old original work never stand in for edition rights.
- Existing manual, bench, baseline, capacity, infrastructure and workflow tickets
  own their scope. New entries cover source expansion, quality protocol, Bible
  research, health/support and handover. No provider, pilot, budget or delivery
  commitment was selected; these are future execution gates, not PR blockers.
- The feat-575 collision had three owners. RAG session recovery becomes feat-619;
  Consumer Manual becomes feat-620; platform feat-575 and historical evidence paths
  stay unchanged. Feat-576 depends on the manual's new ID. Repository-wide legacy
  collisions are pre-existing and not repaired in this bounded documentation job.

## Artifacts

- [Strategy](../roadmap/rag/strategy.md) maps every requested theme to existing/new work.
- [Plan](../plans/2026-10-08-j075-rag-strategy.md) fixes scope and completion criteria.
- [Lane index](../roadmap/rag/README.md) is hand-maintained and remains hidden publicly.
- Feat-621 tracks this documentation delivery; feat-622–626 remain not started.

## Verification

- Changed Markdown: `pnpm exec prettier --check` passes for all 16 changed files.
- `pnpm exec tsx scripts/check-hidden-roadmap-lanes.ts`: passes. It reports 18
  pre-existing public-lane files missing required metadata; no RAG lane is emitted.
- Local Python/YAML audit: all 52 RAG tickets have required fields, reciprocal
  and acyclic dependencies, matching index counts/entries and preserved existing
  statuses. All relative Markdown links in changed files resolve.
- IDs 619–626 are globally unique and feat-575 has one remaining platform owner.
  The audit finds 190 other pre-existing colliding IDs outside this job's scope.
- `git diff --check`: passes. No application file changes.

- `pnpm run format:check`: passes across the repository, including the normal
  pre-commit hook. Hooks were initialized in this worktree and were not skipped.
- `ROADMAP_ID_BASE=565f1835b22191ae8475fb03a719b1545c80d4dd node scripts/check-new-roadmap-ids.mjs`:
  passes with no introduced collision.
- Final lane counts: 52 total, 35 complete, 1 in progress, 16 not started, 0 blocked.
  Only the new documentation delivery feat-621 moves to complete.

## Delivery receipt

Draft PR: [#2605](https://github.com/JesusFilm/forge/pull/2605). Branch:
`docs/j075-rag-strategy`; base: `main`. The PR commit list is the canonical commit
receipt. All local checks above passed; hosted CI is checked separately and is not
implied by local success. No remaining question blocks this roadmap publication.
The future decision gates remain as documented in the strategy.
No application tests, live checks, legal research, source downloads or ingestion
are required or claimed for this documentation-only change. The dependent
ce-code-review remains for the later job as requested.

## Durable maintenance lesson

Allocate IDs only after refreshing the target branch and scanning every lane,
including hidden lanes. When an ID collides, repair filename, frontmatter, active
links and reciprocal dependencies together; preserve historical evidence paths
and add an explicit old-to-new mapping. Feature completion, owner acceptance and
independently observed production behavior must remain separately identifiable.

## Changed files

- `docs/plans/2026-09-30-001-rag-consumer-manual-spec.md`
- `docs/plans/2026-09-30-002-rag-governed-test-bench-spec.md`
- `docs/plans/2026-09-30-rag-portal-session-recovery.md`
- `docs/plans/2026-10-08-j075-rag-strategy.md`
- `docs/reports/2026-10-08-j075-rag-strategy.md`
- `docs/roadmap/rag/README.md`
- `docs/roadmap/rag/feat-576-rag-governed-test-bench.md`
- `docs/roadmap/rag/feat-619-rag-portal-session-recovery.md`
- `docs/roadmap/rag/feat-620-rag-consumer-manual.md`
- `docs/roadmap/rag/feat-621-rag-strategy-roadmap.md`
- `docs/roadmap/rag/feat-622-rag-source-expansion.md`
- `docs/roadmap/rag/feat-623-rag-source-quality-gates.md`
- `docs/roadmap/rag/feat-624-rag-bible-lookup-research.md`
- `docs/roadmap/rag/feat-625-rag-health-support.md`
- `docs/roadmap/rag/feat-626-rag-operational-handover.md`
- `docs/roadmap/rag/strategy.md`
