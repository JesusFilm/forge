// Shared identity types — kept in a neutral module so both
// `src/graphql/builder.ts` and `src/auth/permissions.ts` can import without
// creating a circular module dependency.
//
// `Principal` represents who is making a request. `null` represents the
// PUBLIC tier (unauthenticated). Logged-in principals carry a stable id
// and a role; SYSTEM workflows use `id: null, role: 'SYSTEM'`.
//
// Per Unit 6 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

/**
 * `WORKFLOW_TRIGGER` is a request-bound service-account role minted at
 * GraphQL context creation when an incoming request carries a valid
 * `Authorization: Bearer <key>` header that matches `WORKFLOW_API_KEYS`.
 * It satisfies a narrow allowlist of embed-trigger permission keys
 * (see `WORKFLOW_TRIGGER_PERMISSIONS` in `permissions.ts`) and nothing
 * else — distinct from `SYSTEM` (workflow-internal, in-process only)
 * and from `ADMIN` (full editorial override). Used by apps/manager to
 * proxy embedding-backfill triggers without minting an admin session.
 */
export type Role =
  | "ADMIN"
  | "EDITOR"
  | "VIEWER"
  | "PUBLIC"
  | "SYSTEM"
  | "WORKFLOW_TRIGGER"

export type Principal = {
  id: string | null
  role: Role
}

/**
 * The workflow-tier principal. Used by every useworkflow job that
 * needs to satisfy `canWriteDerived` at the service layer (scene
 * embeddings, transcript embeddings, experience content dump). Lives
 * here rather than per-workflow so a future tightening of the
 * SYSTEM identity (adding fields, narrowing the role enum) is a
 * one-file change.
 */
export const SYSTEM_PRINCIPAL = {
  id: null,
  role: "SYSTEM",
} as const satisfies Principal

/**
 * Service-account principal minted at GraphQL context creation when a
 * valid bearer key matches. Satisfies only the narrow set of embed-trigger
 * permissions defined in `WORKFLOW_TRIGGER_PERMISSIONS`; never satisfies
 * editorial / SYSTEM gates.
 */
export const WORKFLOW_TRIGGER_PRINCIPAL = {
  id: null,
  role: "WORKFLOW_TRIGGER",
} as const satisfies Principal

/**
 * Editorial-tier predicate: true only for EDITOR/ADMIN. PUBLIC, VIEWER,
 * SYSTEM, WORKFLOW_TRIGGER all return false — none should see drafts via
 * consumer-facing relation paths (Experience.locales, Video.locales).
 */
export function isEditorOrAdmin(user: Principal | null): boolean {
  return user?.role === "ADMIN" || user?.role === "EDITOR"
}
