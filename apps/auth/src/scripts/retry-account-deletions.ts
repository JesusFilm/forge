import { prisma } from "@/db/client"
import {
  createAccountDeletionDeps,
  createAccountDeletionRetryStore,
} from "@/services/account-deletion-runtime"
import { AccountDeletionRetryService } from "@/services/account-deletion.service"

async function run() {
  const retry = new AccountDeletionRetryService(
    createAccountDeletionDeps(),
    createAccountDeletionRetryStore(),
  )
  const result = await retry.retryBatch()
  console.log(JSON.stringify({ event: "account_deletion_retry", ...result }))
  if (result.failed > 0) process.exitCode = 1
}

run().finally(async () => prisma.$disconnect())
