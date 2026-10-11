---
title: "Delete a parent whose report rows restrict it: bounded pages outside, one guarded transaction inside"
date: 2026-10-07
category: database-issues
module: apps/admin push campaigns
problem_type: database_issue
component: service_layer
related_components:
  - database
symptoms:
  - "A delete that lost a race to a second delete ran one unbounded DELETE inside its transaction"
  - "The transaction deleted attributions, then opens, then deliveries, which is the opposite lock order to the delivery cascade"
  - "Delivery pages deleted outside the transaction for a status that could still change were not restored by the rollback"
  - "A test send that raced the delete started a workflow run for a campaign that no longer existed"
  - "The loser of two concurrent deletes saw a 'changed during the delete' refusal for a campaign that was already gone"
root_cause: concurrency
resolution_type: code_fix
severity: medium
tags:
  [
    push-campaigns,
    delete,
    restrict-fk,
    cascade,
    lock-order,
    conditional-delete,
    audit-trail,
    concurrency,
  ]
---

# Delete a parent whose report rows restrict it: bounded pages outside, one guarded transaction inside

## Problem

An editor can delete a push campaign from its admin page (PR #2603, open as of this writing). The campaign's delivery, open, and attribution rows reference it with `onDelete: Restrict` (`apps/admin/prisma/schema.prisma:6245`, `:6274`, `:6305`). A sent campaign can hold one delivery row per phone. So the delete must remove many child rows first. It must also stay correct when a schedule, a test send, a run finish, or a second delete runs at the same time.

## Symptoms

Code review and deliberate falsification found each of these before merge. None reached production.

- A delete that lost a race to a second delete fell into one unbounded `DELETE` inside its transaction.
- The transaction deleted attributions, then opens, then deliveries. The paged deletes lock in the opposite order, so two overlapping deletes could deadlock.
- Delivery pages that a draft lost outside the transaction stayed lost when a concurrent schedule made the transaction roll back.
- A test send that raced the delete started a workflow run for a missing campaign.
- The loser of two concurrent deletes saw "This campaign changed during the delete" for a campaign that was already gone.

## What Didn't Work

- **Paging for every status.** The first draft deleted delivery pages before the transaction for every campaign. A draft can still be scheduled after the gate read. The pages are outside the rollback, so the rows were gone when the transaction rolled back. A deliberately broken copy made the real-database rollback test fail.
- **Stopping the page loop on a zero-count delete.** Two concurrent deletes read the same page. The loser's `deleteMany` moved 0 rows, and the loop stopped on `if (count === 0) break`. The loser then deleted every remaining row in one statement inside its transaction. The second review round's adversarial reviewer found this.
- **Children first inside the transaction.** The transaction deleted attributions, then opens, then deliveries. A paged delivery delete locks the delivery first, then its cascade locks the open and the attribution. Two deletes that use opposite orders can deadlock. `recommendation-retention-cascade-lock-order-20260929.md` records the same class of deadlock in retention.
- **One message for every lost conditional delete.** When a second delete committed first, the loser's conditional delete moved 0 rows, and the code always threw the "changed" refusal. The editor saw an error, not the campaign list.
- **Trusting the ledger row alone.** A run that died without its own failure step leaves its `workflow_run` row at `running`. A gate that trusts only the ledger refuses that campaign's delete forever.
- **An unconditional link in dispatch.** `dispatchPushCampaignRun` linked a new run with an `updateMany` and ignored the count. A delete that committed between a test send's checks and that write let the run start for a missing campaign.

## Solution

`deletePushCampaign` (`apps/admin/src/services/push/campaign.service.ts:597`) runs four steps.

1. **The gate (outside the transaction).** It refuses a scheduled or sending campaign. It refuses a test run inside its 15-minute receipt window. For a ledger row at queued or running that carries a runtime run id, it asks the workflow runtime, as the recovery sweep does, and refuses unless the runtime says terminal (`:578`). A row with no runtime run id counts as finished, as in the sweep. It refuses while a live claim-holding delivery still guards a phone's day: until the latest local date plus 36 hours, and the latest claim plus 20 hours (`:529`). A local date ends last in UTC-12, 36 hours after that date starts in UTC (`:68`).
2. **Bounded pages.** Only for sent, paused, and cancelled campaigns (`SETTLED_STATUSES`, `:419`). No transition leaves these statuses, and the gate refused a live run, so no writer adds a delivery. The pages go in id order, 5,000 rows each. A page that moves 0 rows does not end the loop. Only an empty read ends it.
3. **One guarded transaction.** It reads a snapshot (copy, zones, content version). It deletes deliveries first, in the cascade's own order. Then it deletes any stray attributions and opens that the delivery cascade did not reach. Then it deletes the campaign with a conditional `deleteMany` and writes the audit row.
4. **Dispatch checks its link.** `dispatchPushCampaignRun` (`apps/admin/src/services/push/dispatch.ts:213-217`) now refuses to start a run when its link to the campaign moves no row.

```ts
// Inside the transaction (campaign.service.ts)
const { count } = await tx.pushDelivery.deleteMany({
  where: { campaignId: input.campaignId },
})
await tx.pushAttribution.deleteMany({ where: { campaignId: input.campaignId } })
await tx.pushOpen.deleteMany({ where: { campaignId: input.campaignId } })
const deleted = await tx.pushCampaign.deleteMany({
  where: {
    id: input.campaignId,
    status: gate.status, // read by the gate, before the pages
    workflowRunLogId: gate.workflowRunLogId, // a new run rewrites this
    contentVersion: snapshot.contentVersion, // an agent or dashboard edit raises this
  },
})
if (deleted.count !== 1) {
  const remaining = await tx.pushCampaign.count({
    where: { id: input.campaignId },
  })
  if (remaining === 0)
    throw new PushNotFoundError("That campaign does not exist")
  throw new PushCampaignNotDeletableError(
    "This campaign changed during the delete. ...",
  )
}
await tx.workflowRun.create({
  data: deleteAuditRow(input, snapshot, pagedDeliveries + count, now),
})
```

## Why This Works

- **Pages cannot race a new row.** The pages run only for statuses that no transition leaves, after the gate refused a live run. A draft or a tested campaign has only test rows, and the transaction deletes those.
- **One lock order removes the deadlock cycle.** Every path that reaches a delivery locks the delivery first, and the cascade then locks its open and its attribution. The campaign row comes last. Id-ordered pages make two pagers lock in the same order as well.
- **The conditional delete pins what the checks read.** A schedule changes the status. A new run changes the run id. An edit raises the content version. Any of these makes the delete move 0 rows, and the whole transaction rolls back, including the audit row.
- **The loser reads as not found.** Under the default READ COMMITTED level, the loser's blocked `DELETE` finds no row after the winner commits. The `count` then sees the winner's commit and returns 0.
- **The audit row cannot disagree with the delete.** It is in the same transaction, so a committed delete always has its row and a rolled-back one never does. The zones go only with the campaign row, so they keep the planned reach even when an earlier, stopped delete paged some deliveries.

A real-Postgres suite (`apps/admin/src/services/push/campaign-delete.db.test.ts`) proves that the restricted report rows go before the campaign, and it proves paging, the refusals, the rollback, two concurrent deletes, and the audit row. Only a mocked call-order test pins the lock order itself. A local stress run, not committed, deleted a sent campaign with about 15,000 deliveries from two calls at once, five times. Every round ended with one success and one "not found", and no deadlock.

## Prevention

- Before you page a child table outside the transaction, prove that no writer can add rows for that parent state. Page only in those states.
- Delete in the cascade's own order on every path. Order pages by a stable key.
- End a page loop on an empty read. Do not end it on a delete that moved 0 rows.
- Pin every value that the checks read in the final conditional write. When it moves 0 rows, read the row again to tell "gone" from "changed".
- When a parent row can now disappear, check the count of every unconditional `updateMany` that links new work to it.
- Write the audit row in the same transaction as the delete.
- Test with real Postgres:
  - two concurrent deletes through `Promise.allSettled`
  - a rollback injected through a hook between the gate and the transaction
  - the audit row's contents

  A mocked `$transaction` has no row locks, so it proves branch shape only.

## Related Issues

- PR #2603: the push campaign delete.
- `docs/solutions/database-issues/recommendation-retention-cascade-lock-order-20260929.md`: lock order must follow the cascade.
- `docs/solutions/database-issues/recommendation-retention-profile-tail-pages-20261003.md`: bounded, id-ordered page deletes.
- `docs/solutions/database-issues/db-lock-must-be-atomic-update-not-select-for-update.md`: a conditional write with the count as the race discriminator.
- `docs/solutions/architecture-patterns/agent-and-person-share-one-versioned-write-path.md`: the content version that this delete also pins.
- `apps/admin/CLAUDE.md`, section "Campaign delete": the operator-facing rules.
