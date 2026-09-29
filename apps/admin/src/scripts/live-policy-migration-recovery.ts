import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client } from "pg"

export const LIVE_POLICY_MIGRATION = "0110_recommendation_live_policy_manifests"

type FailedMigration = { migration_name: string; checksum: string }

export class MigrationRecoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MigrationRecoveryError"
  }
}

/** Only the exact reviewed, idempotent migration may be replayed. */
export function assertLivePolicyRecoveryIdentity(
  failed: FailedMigration[],
  migrationSql: string,
) {
  const checksum = createHash("sha256").update(migrationSql).digest("hex")
  if (
    failed.length !== 1 ||
    failed[0]?.migration_name !== LIVE_POLICY_MIGRATION ||
    failed[0]?.checksum !== checksum
  )
    throw new MigrationRecoveryError(
      "Live-policy migration recovery identity does not match",
    )
}

export async function verifyLivePolicyMigrationRecovery() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString)
    throw new MigrationRecoveryError("Migration recovery requires DATABASE_URL")
  const migrationSql = await readFile(
    new URL(
      `../../prisma/migrations/${LIVE_POLICY_MIGRATION}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  )
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 2_000,
    query_timeout: 2_500,
    application_name: "forge-live-policy-migration-recovery",
  })
  try {
    await client.connect()
    const { rows } = await client.query<FailedMigration>(`
      SELECT migration_name, checksum FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
      ORDER BY started_at DESC LIMIT 2
    `)
    assertLivePolicyRecoveryIdentity(rows, migrationSql)
  } finally {
    await client.end()
  }
}
