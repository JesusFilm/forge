import {
  verifyUsageRoles,
  ConsumerRoleVerificationError,
} from "./consumer-role-policy.js"
import { PrismaClient } from "../src/generated/prisma/index.js"

async function main(): Promise<void> {
  const writerUrl = process.env.RAG_USAGE_WRITER_DATABASE_URL
  const readerUrl = process.env.RAG_USAGE_REPORT_DATABASE_URL
  if (!writerUrl || !readerUrl) throw new ConsumerRoleVerificationError()
  const writer = new PrismaClient({ datasourceUrl: writerUrl })
  const reader = new PrismaClient({ datasourceUrl: readerUrl })
  try {
    await verifyUsageRoles(writer, reader)
  } finally {
    await Promise.all([writer.$disconnect(), reader.$disconnect()])
  }
  console.log("consumer usage roles verified")
}

main().catch(() => {
  console.error("consumer usage role verification failed (details redacted)")
  process.exitCode = 1
})
