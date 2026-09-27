import { verifyConsumerRoles } from "./consumer-role-policy.js"
import { PrismaClient } from "../src/generated/prisma/index.js"

class ConsumerRoleVerificationError extends Error {
  override readonly name = "ConsumerRoleVerificationError"
  constructor(
    readonly code:
      | "role_probe_empty"
      | "consumer_role_urls_required"
      | "consumer_role_privileges_invalid",
  ) {
    super(code)
  }
}

async function main(): Promise<void> {
  const writerUrl = process.env.RAG_CONSUMER_WRITER_DATABASE_URL
  const readerUrl = process.env.RAG_CONSUMER_AUTH_DATABASE_URL
  if (!writerUrl || !readerUrl)
    throw new ConsumerRoleVerificationError("consumer_role_urls_required")
  const writer = new PrismaClient({ datasourceUrl: writerUrl })
  const reader = new PrismaClient({ datasourceUrl: readerUrl })
  try {
    await verifyConsumerRoles(writer, reader)
  } finally {
    await Promise.all([writer.$disconnect(), reader.$disconnect()])
  }
  console.log("consumer access roles verified")
}

main().catch(() => {
  console.error("consumer access role verification failed (details redacted)")
  process.exitCode = 1
})
