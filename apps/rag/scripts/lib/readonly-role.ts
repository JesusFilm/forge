import {
  DEFAULT_READONLY_LOGIN_ROLE,
  READONLY_GROUP_ROLE,
  requireReadonlyRoleName,
} from "../../src/config/database-url.js"

export { DEFAULT_READONLY_LOGIN_ROLE, READONLY_GROUP_ROLE }

const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/
const GENERATED_PASSWORD = /^[a-f0-9]{64}$/

export const LARGE_OBJECT_MUTATOR_FUNCTIONS = [
  "pg_catalog.lo_creat(integer)",
  "pg_catalog.lo_create(oid)",
  "pg_catalog.lo_from_bytea(oid,bytea)",
  "pg_catalog.lo_import(text)",
  "pg_catalog.lo_import(text,oid)",
  "pg_catalog.lowrite(integer,bytea)",
  "pg_catalog.lo_truncate(integer,integer)",
  "pg_catalog.lo_truncate64(integer,bigint)",
  "pg_catalog.lo_put(oid,bigint,bytea)",
  "pg_catalog.lo_unlink(oid)",
] as const

export const LARGE_OBJECT_MUTATOR_SQL =
  LARGE_OBJECT_MUTATOR_FUNCTIONS.join(", ")

export function requireRoleName(value: string | undefined): string {
  return requireReadonlyRoleName(value)
}

export function requireGeneratedPassword(value: string | undefined): string {
  const password = value?.trim()
  if (!password || !GENERATED_PASSWORD.test(password))
    throw new Error(
      "read-only role provisioning refused: JFRAG_READONLY_PASSWORD must be 64 lowercase hexadecimal characters",
    )
  return password
}

export function quoteIdentifier(value: string): string {
  if (!ROLE_NAME.test(value)) throw new Error("unsafe PostgreSQL identifier")
  return `"${value}"`
}

export function quotePassword(value: string): string {
  return `'${requireGeneratedPassword(value)}'`
}

export type ReadonlyPrivilegeSummary = {
  transaction_read_only: boolean
  elevated_role_attributes: boolean
  database_create: boolean
  database_temporary: boolean
  writable_schemas: bigint
  owned_schemas: bigint
  writable_relations: bigint
  owned_relations: bigint
  writable_sequences: bigint
  owned_large_objects: bigint
  executable_large_object_mutators: bigint
  executable_security_definer_functions: bigint
  unexpected_memberships: bigint
}

export function privilegeSummarySql(loginRole: string): string {
  const roleLiteral = `'${requireRoleName(loginRole)}'`
  return `
SELECT
  current_setting('transaction_read_only')::boolean AS transaction_read_only,
  EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ${roleLiteral}
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) AS elevated_role_attributes,
  has_database_privilege(${roleLiteral}, current_database(), 'CREATE') AS database_create,
  has_database_privilege(${roleLiteral}, current_database(), 'TEMP') AS database_temporary,
  (SELECT count(*) FROM pg_namespace
    WHERE has_schema_privilege(${roleLiteral}, oid, 'CREATE')) AS writable_schemas,
  (SELECT count(*) FROM pg_namespace n
    JOIN pg_roles owner ON owner.oid = n.nspowner
    WHERE pg_has_role(${roleLiteral}, owner.oid, 'USAGE')) AS owned_schemas,
  (SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND (has_table_privilege(${roleLiteral}, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_has_role(${roleLiteral}, c.relowner, 'USAGE'))) AS writable_relations,
  (SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND pg_has_role(${roleLiteral}, c.relowner, 'USAGE')) AS owned_relations,
  (SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND CASE WHEN c.relkind = 'S'
      THEN has_sequence_privilege(${roleLiteral}, c.oid, 'USAGE,UPDATE')
      ELSE false END) AS writable_sequences,
  (SELECT count(*) FROM pg_largeobject_metadata object
    JOIN pg_roles owner ON owner.oid = object.lomowner
    WHERE pg_has_role(${roleLiteral}, owner.oid, 'USAGE')) AS owned_large_objects,
  (SELECT count(*) FROM (VALUES
    ${LARGE_OBJECT_MUTATOR_FUNCTIONS.map((signature) => `('${signature}')`).join(",\n    ")}
  ) AS mutator(signature)
    WHERE has_function_privilege(${roleLiteral}, signature, 'EXECUTE')) AS executable_large_object_mutators,
  (SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosecdef
      AND has_function_privilege(${roleLiteral}, p.oid, 'EXECUTE')) AS executable_security_definer_functions,
  (SELECT count(*) FROM pg_roles granted
    WHERE granted.rolname NOT IN (${roleLiteral}, '${READONLY_GROUP_ROLE}')
      AND pg_has_role(${roleLiteral}, granted.oid, 'MEMBER')) AS unexpected_memberships
`
}

export function assertReadonlyPrivileges(
  summary: ReadonlyPrivilegeSummary,
): void {
  const failed = Object.entries(summary)
    .filter(([key, value]) =>
      key === "transaction_read_only"
        ? value !== true
        : value !== false && value !== 0n,
    )
    .map(([key]) => key)
  if (failed.length)
    throw new Error(
      `read-only privilege verification failed: ${failed.join(", ")}`,
    )
}

export function databaseUrlForRole(
  administratorUrl: string,
  role: string,
  password: string,
): string {
  const parsed = new URL(administratorUrl)
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("read-only role provisioning requires a PostgreSQL URL")
  parsed.username = requireRoleName(role)
  parsed.password = requireGeneratedPassword(password)
  return parsed.toString()
}
