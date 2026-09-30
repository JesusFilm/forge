import { PrismaClient } from "../../src/generated/prisma/index.js"

export class PortalSessionGrantError extends Error {
  override readonly name = "PortalSessionGrantError"
  constructor(readonly code: string) {
    super(code)
  }
}

type RoleProof = {
  role: string
  database: string
  systemIdentifier: bigint
  schemaUsage: boolean
  statesRead: boolean
  statesInsert: boolean
  statesDelete: boolean
  sessionsRead: boolean
  sessionsInsert: boolean
  sessionsDelete: boolean
  expiryUpdate: boolean
  tableUpdate: boolean
  identityUpdate: boolean
  absoluteUpdate: boolean
  otherSessionUpdate: boolean
  oauthStateUpdate: boolean
  consumerSchema: boolean
  outsidePortalDataPrivilege: boolean
}

async function roleProof(db: PrismaClient): Promise<RoleProof> {
  const [proof] = await db.$queryRaw<RoleProof[]>`
    SELECT current_user AS role, current_database() AS database,
      (SELECT system_identifier FROM pg_control_system()) AS "systemIdentifier",
      has_schema_privilege(current_user, 'portal_private', 'USAGE') AS "schemaUsage",
      has_table_privilege(current_user, 'portal_private.oauth_states', 'SELECT') AS "statesRead",
      has_table_privilege(current_user, 'portal_private.oauth_states', 'INSERT') AS "statesInsert",
      has_table_privilege(current_user, 'portal_private.oauth_states', 'DELETE') AS "statesDelete",
      has_table_privilege(current_user, 'portal_private.sessions', 'SELECT') AS "sessionsRead",
      has_table_privilege(current_user, 'portal_private.sessions', 'INSERT') AS "sessionsInsert",
      has_table_privilege(current_user, 'portal_private.sessions', 'DELETE') AS "sessionsDelete",
      has_column_privilege(current_user, 'portal_private.sessions', 'expires_at', 'UPDATE') AS "expiryUpdate",
      has_table_privilege(current_user, 'portal_private.sessions', 'UPDATE') AS "tableUpdate",
      has_column_privilege(current_user, 'portal_private.sessions', 'github_login', 'UPDATE') AS "identityUpdate",
      has_column_privilege(current_user, 'portal_private.sessions', 'absolute_expires_at', 'UPDATE') AS "absoluteUpdate",
      EXISTS (SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = 'portal_private.sessions'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'expires_at'
          AND has_column_privilege(current_user, a.attrelid, a.attname, 'UPDATE')) AS "otherSessionUpdate",
      has_any_column_privilege(current_user, 'portal_private.oauth_states', 'UPDATE') AS "oauthStateUpdate",
      has_schema_privilege(current_user, 'consumer_private', 'USAGE') AS "consumerSchema",
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'portal_private')
          AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (has_any_column_privilege(current_user, c.oid, 'SELECT')
            OR has_any_column_privilege(current_user, c.oid, 'INSERT')
            OR has_any_column_privilege(current_user, c.oid, 'UPDATE')
            OR has_table_privilege(current_user, c.oid, 'DELETE')
            OR has_table_privilege(current_user, c.oid, 'TRUNCATE'))) AS "outsidePortalDataPrivilege"
  `
  if (!proof) throw new PortalSessionGrantError("session_role_proof_missing")
  return proof
}

function restricted(proof: RoleProof): boolean {
  return (
    proof.schemaUsage &&
    proof.statesRead &&
    proof.statesInsert &&
    proof.statesDelete &&
    proof.sessionsRead &&
    proof.sessionsInsert &&
    proof.sessionsDelete &&
    !proof.tableUpdate &&
    !proof.identityUpdate &&
    !proof.absoluteUpdate &&
    !proof.otherSessionUpdate &&
    !proof.oauthStateUpdate &&
    !proof.consumerSchema &&
    !proof.outsidePortalDataPrivilege
  )
}

/** Runs after schema migration and before the portal service starts. */
export async function grantPortalSessionRenewal(
  administratorUrl: string,
  sessionUrl: string,
): Promise<{ database: string; role: string; expiryUpdate: true }> {
  const administrator = new PrismaClient({ datasourceUrl: administratorUrl })
  const session = new PrismaClient({ datasourceUrl: sessionUrl })
  try {
    const before = await roleProof(session)
    const [target] = await administrator.$queryRaw<
      { database: string; systemIdentifier: bigint; canGrant: boolean }[]
    >`SELECT current_database() AS database,
        (SELECT system_identifier FROM pg_control_system()) AS "systemIdentifier",
        has_table_privilege(current_user, 'portal_private.sessions', 'UPDATE') AS "canGrant"`
    if (
      !target ||
      target.database !== before.database ||
      target.systemIdentifier !== before.systemIdentifier ||
      !target.canGrant
    )
      throw new PortalSessionGrantError("portal_database_target_mismatch")
    if (!restricted(before))
      throw new PortalSessionGrantError("portal_session_role_not_restricted")
    // The identifier came from PostgreSQL current_user; quote it before SQL use.
    const role = `"${before.role.replaceAll('"', '""')}"`
    await administrator.$executeRawUnsafe(
      `GRANT UPDATE (expires_at) ON portal_private.sessions TO ${role}`,
    )
    const after = await roleProof(session)
    if (
      after.role !== before.role ||
      after.database !== before.database ||
      after.systemIdentifier !== before.systemIdentifier ||
      !restricted(after) ||
      !after.expiryUpdate
    )
      throw new PortalSessionGrantError(
        "portal_session_grant_verification_failed",
      )
    return { database: after.database, role: after.role, expiryUpdate: true }
  } finally {
    await Promise.all([administrator.$disconnect(), session.$disconnect()])
  }
}
