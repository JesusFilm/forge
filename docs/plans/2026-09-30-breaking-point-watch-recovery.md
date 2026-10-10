---
title: "Recover Breaking Point on Watch"
type: fix
status: complete
date: 2026-09-30
---

Tanner's PR #2476 already repairs the anonymous Core query and dependent
checkpoint handling. Continue from merged `1403be0a4`; do not duplicate the fix.

1. Verify production Admin and worker deploy that commit through normal main
   rollout. Confirm no competing Core sync is active.
2. Use the deployed `core-sync:run --full` command over Railway SSH. A full
   phase exceeds the Workflow HTTP step's observed five-minute limit; its
   retries overlap the still-running original phase. Cancel the recovery
   workflow and verify all active attempts finish before releasing its lock
   with the existing owner-checked release function. Replay dependent media because their
   checkpoints advanced while parent videos were missing. Use normal locks and
   guarded soft-deletion; no manual row insertion or restriction bypass.
3. Track phase errors and completion, then verify the series and four episode
   rows, relations, English dubs, thumbnails, and public routes. Replay the
   videos phase if cross-page child creation requires relation reconciliation.
4. Check the actual serving search projection. Refresh using its supported
   indexing entry point if necessary, then verify the English Watch UI and
   public GraphQL search independently.
5. Record evidence in feat-578 and compound the recovery lesson. Keep any
   additional monitoring or ongoing visibility-reconciliation work separate.

The supported index publication builds an immutable Candidate and moves only
EVALUATION. Verify the new snapshot privately before seeking any required
operator acceptance and promoting it. Preserve actual failing and missing
gate results; never label an incomplete evaluation qualified. Serving pointer
and environment selector must be coordinated through the normal release flow.

The manual qualification checkpoint in
`apps/admin/docs/breaking-point-watch-recovery.md` is historical. Its failed and
missing gates remain failed and missing; no operator acceptance was submitted.
The later authorized content-delivery implementation in PR #2493 supersedes
that release sequence. See `2026-09-30-automatic-core-watch-publication.md` for
actual publication evidence. Public Watch search now shows the series and all
four episodes while the qualified engine baseline remains unchanged.

Acceptance: searching `Breaking Point` on Watch returns Holly's series, its
public route presents all four episodes, and episode playback is available.
