import { randomUUID } from "node:crypto"

import { getAdminUserPlaylistLifecycleConfig } from "@/config/env"
import { prisma } from "@/db/client"
import {
  createAccountDeletionDeps,
  createAccountDeletionRetryStore,
} from "@/services/account-deletion-runtime"
import { AccountDeletionRetryService } from "@/services/account-deletion.service"
import {
  ConsumerEligibilityService,
  ConsumerLifecycleReconciliationService,
} from "@/services/consumer-eligibility.service"
import {
  ConsumerLifecycleOutboxService,
  SignedConsumerLifecycleSender,
} from "@/services/consumer-lifecycle-outbox.service"
import { runConsumerLifecycleJob } from "@/services/consumer-lifecycle-runner.service"

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
  const sender = new SignedConsumerLifecycleSender(config)
  const outbox = new ConsumerLifecycleOutboxService(prisma, {
    send: (event) => sender.send(event),
  })
  const deletion = new AccountDeletionRetryService(
    createAccountDeletionDeps(),
    createAccountDeletionRetryStore(),
  )
  const result = await runConsumerLifecycleJob({
    workerId: randomUUID(),
    reconciliation,
    outbox,
    deletion,
  })

  console.log(JSON.stringify(result))
  process.exitCode = result.exitCode
}

run().finally(async () => prisma.$disconnect())
