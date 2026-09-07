import { environmentConfigurationError } from "./environment-error.js"

export const READONLY_GROUP_ROLE = "forge_rag_readonly"
export const DEFAULT_READONLY_LOGIN_ROLE = "forge_rag_evaluator"

const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/
const RESERVED_READONLY_LOGIN_ROLES = new Set([
  READONLY_GROUP_ROLE,
  "postgres",
  "forge",
])

export function requireReadonlyRoleName(value: string | undefined): string {
  const role = value?.trim() || DEFAULT_READONLY_LOGIN_ROLE
  if (!ROLE_NAME.test(role) || RESERVED_READONLY_LOGIN_ROLES.has(role))
    throw new Error(
      "read-only role provisioning refused: login role must be a distinct lowercase PostgreSQL identifier",
    )
  return role
}

export function requireReadonlyDatabaseUrl(
  databaseUrl: string,
  roleName: string | undefined,
): string {
  const parsed = new URL(databaseUrl)
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("read-only database URL must use PostgreSQL")
  const role = requireReadonlyRoleName(roleName)
  if (decodeURIComponent(parsed.username) !== role)
    throw new Error(
      "read-only database URL username must match JFRAG_READONLY_ROLE_NAME",
    )
  return parsed.toString()
}

export type DashboardDatabase = {
  url: string
  source: "JFRAG_POSTGRESQL_READONLY_DB_URL" | "DATABASE_URL"
}

export function resolveDashboardDatabase(
  input: Record<string, string | undefined>,
  options: { allowDev?: boolean } = {},
): DashboardDatabase {
  const namespaced = input.JFRAG_POSTGRESQL_READONLY_DB_URL?.trim()
  if (namespaced) {
    return {
      url: requireReadonlyDatabaseUrl(
        namespaced,
        input.JFRAG_READONLY_ROLE_NAME,
      ),
      source: "JFRAG_POSTGRESQL_READONLY_DB_URL",
    }
  }

  const generic = input.DATABASE_URL?.trim()
  if (!generic) {
    throw environmentConfigurationError(
      "dashboard_database_required",
      "JFRAG_POSTGRESQL_READONLY_DB_URL is required for a dashboard read",
      "dashboard",
    )
  }
  if (!options.allowDev) {
    throw environmentConfigurationError(
      "dashboard_generic_database_refused",
      "Refusing a production dashboard snapshot from DATABASE_URL; use the explicit namespaced production credential",
      "dashboard",
    )
  }
  const parsed = new URL(generic)
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("dashboard database URL must use PostgreSQL")
  return { url: parsed.toString(), source: "DATABASE_URL" }
}

export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl)
    const user = parsed.username || "?"
    const host = parsed.hostname || "?"
    const port = parsed.port ? `:${parsed.port}` : ""
    const database = parsed.pathname.replace(/^\//, "") || "?"
    return `${parsed.protocol}//${user}:***@${host}${port}/${database}`
  } catch {
    return "(unparseable)"
  }
}
