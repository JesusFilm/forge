import { pathToFileURL } from "node:url"

import { Pool } from "pg"

import { getMastraDatabaseUrl } from "../config/env"
import {
  getSupportResearchDatabaseReadiness,
  type SupportResearchDatabase,
} from "../services/support-research/database-readiness"

export async function runSupportResearchDatabaseReadinessCli(options?: {
  database?: SupportResearchDatabase
  stdout?: (message: string) => void
}): Promise<number> {
  let pool: Pool | undefined
  let database = options?.database
  if (!database) {
    pool = new Pool({
      connectionString: getMastraDatabaseUrl(),
      max: 1,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
      allowExitOnIdle: true,
    })
    database = pool
  }

  try {
    const readiness = await getSupportResearchDatabaseReadiness(database)
    const stdout = options?.stdout ?? process.stdout.write.bind(process.stdout)
    stdout(`${JSON.stringify(readiness)}\n`)
    return readiness.ready ? 0 : 1
  } finally {
    await pool?.end()
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runSupportResearchDatabaseReadinessCli()
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        ready: false,
        reason: "support research database readiness check failed",
      })}\n`,
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main()
}
