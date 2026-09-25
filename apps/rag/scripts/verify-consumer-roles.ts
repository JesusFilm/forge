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

type Privileges = {
  role: string
  superuser: boolean
  schema_usage: boolean
  consumers_read: boolean
  consumers_write: boolean
  members_read: boolean
  members_write: boolean
  credentials_read: boolean
  credentials_write: boolean
  audit_insert: boolean
  audit_read: boolean
  revision_insert: boolean
  revision_read: boolean
  corpus_read: boolean
  portal_read: boolean
  usage_write: boolean
}

async function inspect(url: string): Promise<Privileges> {
  const db = new PrismaClient({ datasourceUrl: url })
  try {
    const [row] = await db.$queryRaw<Privileges[]>`
      SELECT current_user AS role,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
             has_schema_privilege(current_user, 'consumer_private', 'USAGE') AS schema_usage,
             has_table_privilege(current_user, 'consumer_private.consumers', 'SELECT') AS consumers_read,
             (has_table_privilege(current_user, 'consumer_private.consumers', 'INSERT') AND
              has_table_privilege(current_user, 'consumer_private.consumers', 'UPDATE')) AS consumers_write,
             has_table_privilege(current_user, 'consumer_private.members', 'SELECT') AS members_read,
             (has_table_privilege(current_user, 'consumer_private.members', 'INSERT') AND
              has_table_privilege(current_user, 'consumer_private.members', 'DELETE')) AS members_write,
             has_table_privilege(current_user, 'consumer_private.credentials', 'SELECT') AS credentials_read,
             (has_table_privilege(current_user, 'consumer_private.credentials', 'INSERT') AND
              has_table_privilege(current_user, 'consumer_private.credentials', 'UPDATE')) AS credentials_write,
             has_table_privilege(current_user, 'consumer_private.lifecycle_audit', 'INSERT') AS audit_insert,
             has_table_privilege(current_user, 'consumer_private.lifecycle_audit', 'SELECT') AS audit_read,
             has_table_privilege(current_user, 'consumer_private.allowlist_revisions', 'INSERT') AS revision_insert,
             has_table_privilege(current_user, 'consumer_private.allowlist_revisions', 'SELECT') AS revision_read,
             CASE WHEN has_schema_privilege(current_user, 'public', 'USAGE')
               THEN has_table_privilege(current_user, 'public.sources', 'SELECT')
               ELSE false END AS corpus_read,
             CASE WHEN has_schema_privilege(current_user, 'portal_private', 'USAGE')
               THEN has_table_privilege(current_user, 'portal_private.sessions', 'SELECT')
               ELSE false END AS portal_read,
             has_table_privilege(current_user, 'consumer_private.usage_daily', 'INSERT') AS usage_write
    `
    if (!row) throw new ConsumerRoleVerificationError("role_probe_empty")
    return row
  } finally {
    await db.$disconnect()
  }
}

async function main(): Promise<void> {
  const writerUrl = process.env.RAG_CONSUMER_WRITER_DATABASE_URL
  const readerUrl = process.env.RAG_CONSUMER_AUTH_DATABASE_URL
  if (!writerUrl || !readerUrl)
    throw new ConsumerRoleVerificationError("consumer_role_urls_required")
  const writer = await inspect(writerUrl)
  const reader = await inspect(readerUrl)
  const bothRestricted =
    writer.role !== reader.role &&
    !writer.superuser &&
    !reader.superuser &&
    writer.schema_usage &&
    reader.schema_usage &&
    !writer.corpus_read &&
    !reader.corpus_read &&
    !writer.portal_read &&
    !reader.portal_read &&
    !writer.usage_write &&
    !reader.usage_write
  const writerCorrect =
    writer.consumers_read &&
    writer.consumers_write &&
    writer.members_read &&
    writer.members_write &&
    writer.credentials_read &&
    writer.credentials_write &&
    writer.audit_insert &&
    !writer.audit_read &&
    writer.revision_insert &&
    !writer.revision_read
  const readerCorrect =
    reader.consumers_read &&
    reader.credentials_read &&
    !reader.consumers_write &&
    !reader.members_read &&
    !reader.members_write &&
    !reader.credentials_write &&
    !reader.audit_insert &&
    !reader.audit_read &&
    !reader.revision_insert &&
    !reader.revision_read
  if (!bothRestricted || !writerCorrect || !readerCorrect)
    throw new ConsumerRoleVerificationError("consumer_role_privileges_invalid")
  console.log("consumer access roles verified")
}

main().catch(() => {
  console.error("consumer access role verification failed (details redacted)")
  process.exitCode = 1
})
