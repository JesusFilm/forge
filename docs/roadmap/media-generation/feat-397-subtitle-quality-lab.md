---
id: "feat-397"
title: "Subtitle quality lab"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-20"
duration: 12
depends_on:
  - "feat-049"
blocks:
  - "feat-438"
tags:
  - "manager"
  - "mastra"
  - "admin"
  - "subtitles"
  - "evaluation"
  - "human-review"
  - "multilingual"
---

## Problem

Forge has a reproducible local subtitle-translation evaluator but no durable cloud run history or safe workflow for native speakers to review AI subtitles. Manager access currently assumes every member is a full operator, so language contributors cannot participate without receiving excessive access.

## Entry Points — Read These First

1. `docs/plans/2026-08-20-1414-feat-subtitle-quality-lab-plan.md` — canonical implementation contract
2. `apps/mastra/src/evals/subtitle-translation/runner.ts` — existing offline evaluator
3. `apps/mastra/evals/subtitle-translation/manifest.json` — five-case human-reference corpus
4. `apps/manager/src/workflows/smartCrop.ts` — durable orchestration and terminal report pattern
5. `apps/manager/src/features/jobs/review-player/review-player-card.tsx` — synchronized video/subtitle review pattern
6. `apps/admin/prisma/schema.prisma` — Manager membership, language identity, and immutable ledger patterns

## Grep These

- `ManagerRole|ManagerMembership|authenticateRequest|requireAuth`
- `SeoRun|SeoProposalVersion|SeoDecision|SeoExperiment`
- `forge-subtitle-enrichment|runSubtitleEval|compareSubtitleCues`
- `useVideoPlayerCore|textTracks|currentTime`

## What To Build

- Add a separate `REVIEWER` Manager role with exact Admin-language grants while preserving every existing Manager route as operator-only.
- Add an Admin-owned versioned corpus with exact VTT byte snapshots, leased run/cell execution, one immutable terminal report, review assignment rounds, separate machine assessment, append-only human review, and read-only comparison ledger.
- Add a protected one-cell Mastra cloud evaluator that verifies frozen Core VTT hashes, runs production translation/retiming, and returns metrics plus segment-native review evidence.
- Add a Manager durable workflow that creates state before paid work, writes content-addressed report/VTT artifacts to Railway S3, and uses fenced stale-run recovery to finalize one report on partial or total failure.
- Add operator run/report/assignment/comparison pages and a separate review-only contributor surface with synchronized video, source/human/AI subtitles, cue navigation, loop playback, and internationalized diffs.

## Constraints

- Language authorization keys on Admin `Language.id` and stable slug, never BCP-47 alone.
- Reviewers can access only their assigned case-language cells and cannot launch runs or access existing Manager dashboard APIs.
- Machine assessments never count as human approval, gold approval, or specialist approval.
- Evaluation has no mutation path to published subtitles, production prompt labels, deployments, or merge state.
- Reviewer A/B presentation is assignment-stable and blind until submission; operators retain full provenance.
- Admin schema changes regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` in the same change.
- Do not deploy, merge, push, or open a PR without explicit user instruction.

## Operations Handoff

The implementation is local-only while this ticket is `in-progress`. The
package runbooks are authoritative for operations:

- `apps/admin/CLAUDE.md` — reviewer grants/revocation, review-proof keyring,
  corpus certification, spend admission, immutable ledger, and contributor
  data/retention gate.
- `apps/manager/CLAUDE.md` — production configuration order, S3 fail-closed
  behavior, cloud run/recovery lifecycle, reviewer surface, browser QA, and the
  no-publication boundary.
- `apps/mastra/CLAUDE.md` and
  `apps/mastra/evals/subtitle-translation/README.md` — packaged corpus,
  paid-key setup, one-cell cloud runner, OpenRouter provider-call evidence,
  API.Bible limitation, and offline commands.

Operational invariants:

- Production Admin must have all five `SUBTITLE_EVAL_*` admission values.
  Admin derives `cells * maxAttempts * reservationPerCellAttemptMicros`; a
  browser does not declare trusted spend. Deployment values can lower
  ceilings, while the reservation is at least the source-controlled 1,600,000
  spend micros per cell-attempt (64 calls at 25,000 micros each).
- Production Manager must expose `RAILWAY_GIT_COMMIT_SHA` or
  `GIT_COMMIT_SHA`; cloud run admission fails closed on a missing/`unknown`
  immutable code revision.
- Mastra admits at most 80 cues and 64 provider calls per cloud cell, sets a
  4,096-token output cap on every OpenRouter request, and shares one absolute
  cell deadline across detection, translation, retiming retries, Bible lookup,
  and scripture validation.
- Production Manager must have the complete Railway `RAILWAY_S3_*` tuple. The
  Lab never falls back to ephemeral local artifacts in production.
- Process-death recovery is an external scheduled POST to
  `/api/scheduled/subtitle-eval-recovery` with `MANAGER_API_KEY`; the route does
  not schedule itself. Recovery is generation/token fenced and terminalizes or
  relaunches stale work before finalizing the single report.
- Mastra prefers `OPENROUTER_API_PAID_KEY`, then `OPENROUTER_API_KEY`. For a
  local Codex/session run, export the value in the terminal that launches the
  process. Never paste a key into chat or commit it. Do not run a paid smoke
  without explicit cost authorization.
- The immutable provider-call vector covers OpenRouter scripture detection,
  translation, retiming, and scripture validation attempts. API.Bible is
  external evidence retrieval and its request/response identity is not in that
  ledger; reports declare the limitation.
- The current ledger/object store has no Lab-specific TTL, purge,
  pseudonymization, or reviewer-erasure job. Effective retention is indefinite
  until an owner-approved policy and enforcement path exist. Reviewer notes
  must contain quality evidence only, and reviewer-authored evidence is not
  sent to OpenRouter/API.Bible.
- Nothing in the Lab writes published subtitles, activates a prompt/model,
  deploys services, applies migrations, or changes/merges git state.

## Human-Only Prerequisites

These steps require owner or qualified-human authority and cannot be completed
by the implementation agent:

1. A content curator must certify, for all 20 frozen cells, human authorship,
   exact edition/cut synchronization, correct target-language identity,
   reference quality, and benchmark reuse rights. LUMO remains excluded until
   timed human references exist.
2. The owner must identify actual native-language reviewers with existing
   Auth/Admin identities and provide bounded qualification evidence, exact
   language grants, rubric dimensions, and any scripture/theology specialist
   capability. Reviewer invitation and self-service provisioning are deferred.
3. The product/privacy owner must choose contributor notice/consent,
   identity/qualification and free-text retention periods, VTT/report
   retention, pseudonymization, access/export/correction, and erasure behavior
   compatible with immutable evidence. Do not onboard production contributors
   before this decision is implemented.
4. The infrastructure owner must approve/apply migration
   `0052_subtitle_quality_lab`, provision OAuth/service/review-proof/S3/Mux/
   Workflow/OpenRouter secrets, configure the recovery schedule, and authorize
   a bounded paid live smoke.
5. The repository/deployment owner must explicitly authorize any commit, push,
   PR, merge, deployment, prompt/model promotion, or subtitle publication.

## Verification

- Test operator, assigned reviewer, wrong-language reviewer, unassigned reviewer, revoked reviewer, and service-bearer authorization across direct and nested access paths.
- Test idempotent launch, bounded retries, partial failure, artifact failure, immutable report identity, and append-only review supersession.
- Test time-overlap alignment, one-to-many cues, RTL, CJK, combining marks, long captions, keyboard navigation, seek, loop, and review submission.
- Run Admin, Manager, Mastra, and Admin GraphQL tests, lint, and type checks plus roadmap lint and affected-route browser QA.

Exact local validation (no migration, deploy, Core refresh, or paid call):

```bash
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/admin-graphql test
pnpm --filter @forge/admin-graphql lint
pnpm --filter @forge/admin-graphql typecheck
pnpm --filter @forge/manager test
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra lint
pnpm --filter @forge/mastra typecheck
pnpm --filter roadmap lint
git diff --check
```

Manager full typecheck failures outside Subtitle Quality Lab must be recorded
with exact file/error evidence rather than hidden, but unrelated pre-existing
failures do not authorize edits outside this ticket.
