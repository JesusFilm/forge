import { PrismaClient } from "../src/generated/prisma/index.js"
import {
  assertReadonlyPrivileges,
  privilegeSummarySql,
  requireRoleName,
  type ReadonlyPrivilegeSummary,
} from "./lib/readonly-role.js"

class ProbeUnexpectedlySucceeded extends Error {}

function isDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as {
    message?: unknown
    meta?: { code?: unknown; message?: unknown }
  }
  const code = candidate.meta?.code
  const message = `${candidate.message ?? ""} ${candidate.meta?.message ?? ""}`
  return (
    code === "42501" ||
    code === "25006" ||
    /permission denied|read-only transaction/i.test(message)
  )
}

async function expectDenied(
  client: PrismaClient,
  label: string,
  statement: string,
): Promise<void> {
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ WRITE")
      await tx.$executeRawUnsafe(statement)
      throw new ProbeUnexpectedlySucceeded(label)
    })
  } catch (error) {
    if (error instanceof ProbeUnexpectedlySucceeded)
      throw new Error(`read-only verification failed: ${label} succeeded`)
    if (isDenied(error)) return
    throw new Error(
      `read-only verification failed: ${label} was not denied safely`,
    )
  }
}

export async function verifyReadonlyRole(
  databaseUrl: string,
  loginRole: string,
): Promise<void> {
  const role = requireRoleName(loginRole)
  const client = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const [identity] = await client.$queryRaw<
      Array<{ current_user: string; transaction_read_only: boolean }>
    >`SELECT current_user, current_setting('transaction_read_only')::boolean AS transaction_read_only`
    if (identity?.current_user !== role || !identity.transaction_read_only)
      throw new Error(
        "read-only verification failed: connected role or transaction default is incorrect",
      )

    const [summary] = await client.$queryRawUnsafe<ReadonlyPrivilegeSummary[]>(
      privilegeSummarySql(role),
    )
    if (!summary)
      throw new Error("read-only privilege verification returned no row")
    assertReadonlyPrivileges(summary)

    await client.$queryRaw`SELECT count(*) FROM sources`

    const probes = [
      [
        "persistent DDL",
        "CREATE TABLE public.__forge_rag_readonly_probe (id integer)",
      ],
      [
        "temporary DDL",
        "CREATE TEMP TABLE __forge_rag_readonly_probe (id integer)",
      ],
      [
        "INSERT",
        "INSERT INTO sources (key, name) VALUES ('__readonly_probe', '__readonly_probe')",
      ],
      ["UPDATE", "UPDATE sources SET name = name WHERE false"],
      ["DELETE", "DELETE FROM sources WHERE false"],
    ] as const
    for (const [label, statement] of probes)
      await expectDenied(client, label, statement)

    const [residue] = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM sources WHERE key = '__readonly_probe'
    `
    if (residue?.count !== 0n)
      throw new Error("read-only verification failed: probe residue exists")
  } finally {
    await client.$disconnect()
  }
}

async function main(): Promise<void> {
  const target = process.argv[2]
  if (target !== "--local" && target !== "--production")
    throw new Error(
      "read-only verification refused: use --local or --production",
    )
  const databaseUrl = process.env.JFRAG_POSTGRESQL_READONLY_DB_URL?.trim()
  if (!databaseUrl)
    throw new Error(
      "read-only verification refused: JFRAG_POSTGRESQL_READONLY_DB_URL is required",
    )
  if (target === "--production") {
    const expectedHost = process.env.JFRAG_EXPECTED_POSTGRES_HOST?.trim()
    if (!expectedHost || new URL(databaseUrl).hostname !== expectedHost)
      throw new Error(
        "read-only verification refused: database target does not match the approved host",
      )
  }
  const role = requireRoleName(process.env.JFRAG_READONLY_ROLE_NAME)
  await verifyReadonlyRole(databaseUrl, role)
  console.log(
    "read-only database verification passed: SELECT allowed; DDL and DML denied",
  )
}

if (process.argv[1]?.endsWith("verify-readonly.ts")) {
  main().catch((error) => {
    const message =
      error instanceof Error &&
      error.message.startsWith("read-only verification")
        ? error.message
        : "read-only verification failed (details redacted)"
    console.error(message)
    process.exitCode = 1
  })
}
