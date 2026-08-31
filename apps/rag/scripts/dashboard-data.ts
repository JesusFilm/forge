import { createHash } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { fetchProdStatus } from "./lib/dashboard/query.js"
import { prodStatusDataSchema } from "./lib/dashboard/types.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT = path.join(ROOT, "dashboard", "prod-status-data.json")

export function requireProductionDashboardTarget(
  args: string[],
  env: NodeJS.ProcessEnv,
): string {
  if (
    !args.includes("--target") ||
    args[args.indexOf("--target") + 1] !== "production-read"
  )
    throw new Error(
      "dashboard snapshot refused: --target production-read is required",
    )
  const raw = env.JFRAG_POSTGRESQL_DB_URL
  const expected = env.JFRAG_EXPECTED_POSTGRES_HOST?.trim()
  if (!raw || !expected)
    throw new Error(
      "dashboard snapshot refused: namespaced production-read environment is incomplete",
    )
  const url = new URL(raw)
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== expected
  )
    throw new Error(
      "dashboard snapshot refused: database target does not match the approved host",
    )
  return raw
}

async function main(): Promise<void> {
  const databaseUrl = requireProductionDashboardTarget(
    process.argv.slice(2),
    process.env,
  )
  const schema = await readFile(path.join(ROOT, "prisma", "schema.prisma"))
  const source_commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim()
  const client = new PrismaClient({ datasourceUrl: databaseUrl })
  const temporary = `${OUT}.tmp-${process.pid}`
  try {
    const read = await fetchProdStatus(client)
    const snapshot = prodStatusDataSchema.parse({
      schema_version: 1,
      target: "production-read",
      fetched_at: new Date().toISOString(),
      source_commit,
      schema_digest: `sha256:${createHash("sha256").update(schema).digest("hex")}`,
      ...read,
    })
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    })
    await rename(temporary, OUT)
    console.log(
      `dashboard snapshot written: ${snapshot.ingested.length} observed source-language row(s)`,
    )
  } finally {
    await client.$disconnect()
    await rm(temporary, { force: true })
  }
}

if (process.argv[1]?.endsWith("dashboard-data.ts")) {
  main().catch(() => {
    console.error(
      "dashboard snapshot failed; no database details or corpus text were printed",
    )
    process.exitCode = 1
  })
}
