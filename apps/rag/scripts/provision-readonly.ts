import { PrismaClient } from "../src/generated/prisma/index.js"
import {
  databaseUrlForRole,
  LARGE_OBJECT_MUTATOR_SQL,
  quoteIdentifier,
  quotePassword,
  READONLY_GROUP_ROLE,
  requireGeneratedPassword,
  requireRoleName,
} from "./lib/readonly-role.js"

type IdentityRow = { database_name: string; owner_name: string }
type ExistingRoleRow = { rolname: string }
type CountRow = { count: bigint }

function administratorUrl(args: string[], env: NodeJS.ProcessEnv): string {
  const target = args[0]
  if (target === "--local") {
    const url = env.DATABASE_URL?.trim()
    if (!url)
      throw new Error(
        "read-only role provisioning refused: DATABASE_URL is required for --local",
      )
    return url
  }
  if (target !== "--production")
    throw new Error("usage: pnpm db:provision-readonly <--local|--production>")
  if (env.JFRAG_ALLOW_PROD_ROLE_PROVISION !== "1")
    throw new Error(
      "production role provisioning refused: set JFRAG_ALLOW_PROD_ROLE_PROVISION=1",
    )
  const url = env.JFRAG_POSTGRESQL_DB_URL?.trim()
  const expectedHost = env.JFRAG_EXPECTED_POSTGRES_HOST?.trim().toLowerCase()
  if (!url || !expectedHost)
    throw new Error(
      "production role provisioning refused: administrator URL and expected host are required",
    )
  if (new URL(url).hostname.toLowerCase() !== expectedHost)
    throw new Error(
      "production role provisioning refused: database host does not match the approved host",
    )
  return url
}

export async function provisionReadonlyRole(
  adminUrl: string,
  loginRole: string,
  password: string,
): Promise<string> {
  const role = requireRoleName(loginRole)
  const secret = requireGeneratedPassword(password)
  const client = new PrismaClient({ datasourceUrl: adminUrl })
  try {
    const [identity] = await client.$queryRaw<IdentityRow[]>`
      SELECT current_database() AS database_name, current_user AS owner_name
    `
    if (!identity) throw new Error("database identity query returned no row")
    const database = quoteIdentifier(identity.database_name)
    const owner = quoteIdentifier(identity.owner_name)
    const login = quoteIdentifier(role)
    const passwordLiteral = quotePassword(secret)

    const existing = await client.$queryRaw<ExistingRoleRow[]>`
      SELECT rolname FROM pg_roles WHERE rolname = ${role}
    `
    if (existing.length) {
      const [{ count: ownedObjects }] = await client.$queryRaw<CountRow[]>`
        SELECT count(*) AS count
        FROM pg_shdepend dependency
        WHERE dependency.refclassid = 'pg_authid'::regclass
          AND dependency.refobjid = ${role}::regrole
          AND dependency.deptype = 'o'
          AND (
            dependency.dbid = 0 OR dependency.dbid = (
              SELECT oid FROM pg_database WHERE datname = current_database()
            )
          )
      `
      const [{ count: unexpectedMemberships }] = await client.$queryRaw<
        CountRow[]
      >`
        SELECT count(*) AS count
        FROM pg_auth_members member
        JOIN pg_roles granted ON granted.oid = member.roleid
        WHERE member.member = ${role}::regrole
          AND granted.rolname <> ${READONLY_GROUP_ROLE}
      `
      if (ownedObjects !== 0n || unexpectedMemberships !== 0n)
        throw new Error(
          "read-only role provisioning refused: existing login owns objects or has unexpected memberships",
        )
    }

    await client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`
        DO $role$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_roles WHERE rolname = '${READONLY_GROUP_ROLE}'
          ) THEN
            CREATE ROLE ${quoteIdentifier(READONLY_GROUP_ROLE)} NOLOGIN;
          END IF;
        END
        $role$
      `)
        await tx.$executeRawUnsafe(
          `ALTER ROLE ${quoteIdentifier(READONLY_GROUP_ROLE)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        )
        const [groupMemberships] = await tx.$queryRaw<CountRow[]>`
        SELECT count(*) AS count
        FROM pg_auth_members member
        WHERE member.member = ${READONLY_GROUP_ROLE}::regrole
      `
        if (groupMemberships?.count !== 0n)
          throw new Error(
            "read-only role provisioning refused: read-only group has unexpected memberships",
          )
        if (!existing.length) {
          await tx.$executeRawUnsafe(
            `CREATE ROLE ${login} LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`,
          )
        } else {
          await tx.$executeRawUnsafe(
            `ALTER ROLE ${login} LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`,
          )
        }
        await tx.$executeRawUnsafe(
          `REVOKE TEMPORARY ON DATABASE ${database} FROM PUBLIC`,
        )
        await tx.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON DATABASE ${database} FROM ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON DATABASE ${database} FROM ${login}`,
        )
        await tx.$executeRawUnsafe(
          `GRANT CONNECT ON DATABASE ${database} TO ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON SCHEMA public FROM ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${login}`)
        await tx.$executeRawUnsafe(
          `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${login}`,
        )
        await tx.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON TABLES TO ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quoteIdentifier(READONLY_GROUP_ROLE)}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${login}`,
        )
        await tx.$executeRawUnsafe(
          `REVOKE EXECUTE ON FUNCTION ${LARGE_OBJECT_MUTATOR_SQL} FROM PUBLIC, ${quoteIdentifier(READONLY_GROUP_ROLE)}, ${login}`,
        )
        await tx.$executeRawUnsafe(
          `GRANT EXECUTE ON FUNCTION ${LARGE_OBJECT_MUTATOR_SQL} TO ${owner}`,
        )
        await tx.$executeRawUnsafe(
          `GRANT ${quoteIdentifier(READONLY_GROUP_ROLE)} TO ${login}`,
        )
        await tx.$executeRawUnsafe(
          `ALTER ROLE ${login} SET default_transaction_read_only = on`,
        )
      },
      { maxWait: 10_000, timeout: 30_000 },
    )
    return databaseUrlForRole(adminUrl, role, secret)
  } finally {
    await client.$disconnect()
  }
}

async function main(): Promise<void> {
  const url = administratorUrl(process.argv.slice(2), process.env)
  const role = requireRoleName(process.env.JFRAG_READONLY_ROLE_NAME)
  const password = requireGeneratedPassword(process.env.JFRAG_READONLY_PASSWORD)
  await provisionReadonlyRole(url, role, password)
  console.log(
    `read-only database login provisioned: role=${role}; credential value not printed`,
  )
}

if (process.argv[1]?.endsWith("provision-readonly.ts")) {
  main().catch((error) => {
    const message =
      error instanceof Error &&
      (error.message.startsWith("read-only role provisioning refused:") ||
        error.message.startsWith("production role provisioning refused:") ||
        error.message.startsWith("usage:"))
        ? error.message
        : "read-only role provisioning failed (details redacted)"
    console.error(message)
    process.exitCode = 1
  })
}
