import { randomUUID } from "node:crypto"

import { getAdminUserPlaylistLifecycleConfig } from "@/config/env"
import { prisma } from "@/db/client"
import {
  ConsumerEligibilityService,
  ConsumerLifecycleReconciliationService,
} from "@/services/consumer-eligibility.service"
import {
  ConsumerLifecycleOutboxService,
  SignedConsumerLifecycleSender,
} from "@/services/consumer-lifecycle-outbox.service"

async function run() {
  const config = getAdminUserPlaylistLifecycleConfig()
  if (!config) {
    throw new Error(
      "ADMIN_USER_PLAYLIST_LIFECYCLE_URL and USER_PLAYLIST_LIFECYCLE_HMAC_SECRET are required.",
    )
  }

  const eligibility = new ConsumerEligibilityService(prisma)
  const reconciliation = new ConsumerLifecycleReconciliationService(
    prisma,
    eligibility,
  )
  let cursor: string | undefined
  let reconciled = 0
  do {
    const batch = await reconciliation.reconcileBatch({ cursor })
    reconciled += batch.processed
    cursor = batch.nextCursor ?? undefined
  } while (cursor)

  const outbox = new ConsumerLifecycleOutboxService(prisma, {
    send: (event) => new SignedConsumerLifecycleSender(config).send(event),
  })
  const workerId = randomUUID()
  let delivered = 0
  let failed = 0
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await outbox.deliverBatch(workerId)
    delivered += result.delivered
    failed += result.failed
    if (result.delivered === 0 && result.failed === 0) break
  }

  console.log(
    JSON.stringify({
      event: "consumer_lifecycle_run",
      reconciled,
      delivered,
      failed,
    }),
  )
  if (failed > 0) process.exitCode = 1
}

run().finally(async () => prisma.$disconnect())
