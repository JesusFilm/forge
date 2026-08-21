import type { AccountDeletionRetryService } from "./account-deletion.service"
import type { ConsumerLifecycleReconciliationService } from "./consumer-eligibility.service"
import type { ConsumerLifecycleOutboxService } from "./consumer-lifecycle-outbox.service"

type Reconciliation = Pick<
  ConsumerLifecycleReconciliationService,
  "reconcileBatch"
>
type Outbox = Pick<ConsumerLifecycleOutboxService, "deliverBatch" | "getHealth">
type Deletion = Pick<AccountDeletionRetryService, "retryBatch">

export async function runConsumerLifecycleJob(input: {
  workerId: string
  reconciliation: Reconciliation
  outbox: Outbox
  deletion: Deletion
}) {
  let cursor: string | undefined
  let reconciled = 0
  do {
    const page = await input.reconciliation.reconcileBatch({ cursor })
    reconciled += page.processed
    cursor = page.nextCursor ?? undefined
  } while (cursor)

  let batches = 0
  let delivered = 0
  let failed = 0
  for (;;) {
    const batch = await input.outbox.deliverBatch(input.workerId)
    delivered += batch.delivered
    failed += batch.failed
    if (batch.delivered === 0 && batch.failed === 0) break
    batches += 1
  }

  const deletion = await input.deletion.retryBatch()
  const outbox = await input.outbox.getHealth()
  const healthy =
    failed === 0 &&
    deletion.failed === 0 &&
    outbox.dead === 0 &&
    outbox.due === 0
  return {
    event: "consumer_lifecycle_run" as const,
    reconciled,
    delivery: { batches, delivered, failed },
    outbox,
    deletion,
    healthy,
    exitCode: healthy ? 0 : 1,
  }
}
