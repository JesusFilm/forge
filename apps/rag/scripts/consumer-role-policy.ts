import type { PrismaClient } from "../src/generated/prisma/index.js"

export class ConsumerRoleVerificationError extends Error {
  override readonly name = "ConsumerRoleVerificationError"
  constructor() {
    super("consumer_role_privileges_invalid")
  }
}
type Policy = Record<string, readonly string[]>
const writerPolicy: Policy = {
  "consumer_private.consumers": ["SELECT", "INSERT", "UPDATE"],
  "consumer_private.credentials": ["SELECT", "INSERT", "UPDATE"],
  "consumer_private.members": ["SELECT", "INSERT", "DELETE"],
  "consumer_private.lifecycle_audit": ["INSERT"],
  "consumer_private.allowlist_revisions": ["INSERT"],
}
const readerPolicy: Policy = {
  "consumer_private.consumers": ["SELECT"],
  "consumer_private.credentials": ["SELECT"],
}
async function inspect(
  db: PrismaClient,
  policy: Policy,
  schema = "consumer_private",
  permittedLegacy: Policy = {},
): Promise<string> {
  const [role] = await db.$queryRaw<Array<{ role: string; unsafe: boolean }>>`
    SELECT current_user AS role,
      EXISTS (SELECT 1 FROM pg_roles r WHERE
        (r.rolname = current_user OR pg_has_role(current_user, r.oid, 'SET'))
        AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
          OR r.rolname ~ '^pg_'))
      OR EXISTS (SELECT 1 FROM pg_namespace n
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE
            (r.rolname = current_user OR pg_has_role(current_user, r.oid, 'SET'))
            AND has_schema_privilege(r.oid, n.oid, 'CREATE')))
      OR NOT has_schema_privilege(current_user, ${schema}, 'USAGE') AS unsafe
  `
  if (!role || role.unsafe) throw new ConsumerRoleVerificationError()
  const privileges = await db.$queryRaw<
    Array<{
      table: string
      privilege: string
      granted: boolean
      reachable_granted: boolean
      column_granted: boolean
      owner: boolean
    }>
  >`
    SELECT n.nspname || '.' || c.relname AS "table", p.privilege,
      has_table_privilege(current_user, c.oid, p.privilege) AS granted,
      EXISTS (SELECT 1 FROM pg_roles r WHERE
        (r.rolname = current_user OR pg_has_role(current_user, r.oid, 'SET'))
        AND has_table_privilege(r.oid, c.oid, p.privilege)) AS reachable_granted,
        CASE WHEN p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          THEN EXISTS (SELECT 1 FROM pg_roles r WHERE
            (r.rolname = current_user OR pg_has_role(current_user, r.oid, 'SET'))
            AND has_any_column_privilege(r.oid, c.oid, p.privilege))
          ELSE false END AS column_granted,
      (pg_has_role(current_user, c.relowner, 'USAGE') OR pg_has_role(current_user, c.relowner, 'SET')) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  `
  const required = new Set(
    Object.entries(policy).flatMap(([table, grants]) =>
      grants.map((grant) => `${table}:${grant}`),
    ),
  )
  for (const row of privileges) {
    const requiredGrant = required.delete(`${row.table}:${row.privilege}`)
    const legacyGrant =
      permittedLegacy[row.table]?.includes(row.privilege) ?? false
    const expected = requiredGrant || legacyGrant
    if (
      row.owner ||
      (requiredGrant && !row.granted) ||
      (!expected && row.granted) ||
      (!expected && (row.reachable_granted || row.column_granted))
    )
      throw new ConsumerRoleVerificationError()
  }
  const [sequences] = await db.$queryRaw<Array<{ granted: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND EXISTS (SELECT 1 FROM pg_roles r WHERE
          (r.rolname = current_user OR pg_has_role(current_user, r.oid, 'SET'))
          AND (has_sequence_privilege(r.oid, c.oid, 'USAGE') OR
               has_sequence_privilege(r.oid, c.oid, 'SELECT') OR
               has_sequence_privilege(r.oid, c.oid, 'UPDATE')))) AS granted
  `
  if (required.size || sequences?.granted)
    throw new ConsumerRoleVerificationError()
  return role.role
}
/** Checks effective and SET-reachable grants; predefined privilege roles are never required. */
export async function verifyConsumerRoles(
  writer: PrismaClient,
  reader: PrismaClient,
): Promise<void> {
  const writerRole = await inspect(writer, writerPolicy)
  const readerRole = await inspect(reader, readerPolicy)
  if (writerRole === readerRole) throw new ConsumerRoleVerificationError()
}

export async function verifyUsageRoles(
  writer: PrismaClient,
  reader: PrismaClient,
): Promise<void> {
  const writerPolicy: Policy = {
    "usage_private.minutes": ["SELECT", "INSERT", "UPDATE"],
    "usage_private.denials": ["SELECT", "INSERT", "UPDATE"],
    "usage_private.pending": ["SELECT", "INSERT", "DELETE"],
  }
  const readerPolicy: Policy = {
    "usage_private.consumer_labels": ["SELECT"],
    "usage_private.report_minutes": ["SELECT"],
  }
  // Previously provisioned roles may retain these retired metadata grants.
  // They are not required or used; permitting them keeps rolling deployment safe.
  const writerRole = await inspect(writer, writerPolicy, "usage_private", {
    "usage_private.collectors": ["SELECT", "INSERT", "UPDATE"],
    "usage_private.gaps": ["SELECT", "INSERT", "UPDATE"],
  })
  const readerRole = await inspect(reader, readerPolicy, "usage_private", {
    "usage_private.report_collectors": ["SELECT"],
    "usage_private.report_pending": ["SELECT"],
    "usage_private.report_gaps": ["SELECT"],
    "usage_private.report_inventory": ["SELECT"],
  })
  if (writerRole === readerRole) throw new ConsumerRoleVerificationError()
}
