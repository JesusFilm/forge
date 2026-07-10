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
 *
 * `CONSUMER_BEARER` is a request-bound rate-limit-only identity minted
 * at GraphQL context creation when an incoming request carries a valid
 * `Authorization: Bearer <key>` matching `WEB_ADMIN_API_KEYS`. It is
 * granted ZERO permissions beyond PUBLIC — its sole purpose is to
 * bucket consumer SSR traffic (apps/web) separately from anonymous-IP
 * traffic in admin's rate-limit identifier. The principal carries the
 * matched key as `rateLimitBucketKey` so the identifyFn can produce
 * `consumer:<key>` without re-inspecting headers downstream.
 *
 * `MANAGER_BACKEND` is the request-bound service identity used by
 * apps/manager to call Admin-owned Manager read/job contracts. It never
 * grants human panel access.
 *
 * `VIDEO_MAPPER` is the request-bound service identity used by the
 * yt-video-mapper backend to read the flat catalog sync projection. It is
 * intentionally separate from `WORKFLOW_TRIGGER` so existing manager/workflow
 * bearers do not inherit whole-catalog media URL access.
 *
 * `WEB_USER` is a request-bound human identity minted only after Admin
 * introspects a user-delegated Auth access token issued to apps/web. It is
 * intentionally narrower than editorial roles and exists for watch-event
 * writes, not content reads or admin UI access.
 */
export type Role =
  | "ADMIN"
  | "EDITOR"
  | "VIEWER"
  | "PUBLIC"
  | "SYSTEM"
  | "WORKFLOW_TRIGGER"
  | "MANAGER_BACKEND"
  | "VIDEO_MAPPER"
  | "WEB_USER"
  | "CONSUMER_BEARER"

export type Principal = {
  id: string | null
  role: Role
  managerRole?: ManagerRole | null
  /**
   * Set on bearer principals that need rate-limit bucketing — the matched
   * CSV entry from the mint-source env var. Today: `CONSUMER_BEARER`
   * (from `WEB_ADMIN_API_KEYS`). The rate-limit identifyFn reads this
   * without re-inspecting headers and namespaces it as `consumer:<key>`
   * so consumer SSR traffic stays separate from anonymous-IP traffic.
   * Never logged.
   */
  rateLimitBucketKey?: string
}

export type ManagerRole = "OPERATOR"

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

export const MANAGER_BACKEND_PRINCIPAL = {
  id: null,
  role: "MANAGER_BACKEND",
} as const satisfies Principal

export const VIDEO_MAPPER_PRINCIPAL = {
  id: null,
  role: "VIDEO_MAPPER",
} as const satisfies Principal

/**
 * Factory for the request-bound consumer-bearer principal. Mints a
 * Principal carrying the matched bearer key so the rate-limit
 * identifyFn can bucket as `consumer:<key>` without re-inspecting the
 * Authorization header downstream. `id: null` matches the
 * WORKFLOW_TRIGGER convention — bearer principals are non-user
 * identities, no DB row to point at.
 *
 * `CONSUMER_BEARER` grants NO permissions beyond PUBLIC. See
 * `CONSUMER_BEARER_PERMISSIONS` in `permissions.ts` (empty set,
 * CI-asserted) and the early-return in `hasPermission`.
 */
export function CONSUMER_BEARER_PRINCIPAL({
  rateLimitBucketKey,
}: {
  rateLimitBucketKey: string
}): Principal {
  return {
    id: null,
    role: "CONSUMER_BEARER",
    rateLimitBucketKey,
  }
}

export function WEB_USER_PRINCIPAL({
  subject,
}: {
  subject: string
}): Principal {
  return {
    id: subject,
    role: "WEB_USER",
    rateLimitBucketKey: subject,
  }
}

/**
 * Editorial-tier predicate: true only for EDITOR/ADMIN. PUBLIC, VIEWER,
 * SYSTEM, WORKFLOW_TRIGGER, MANAGER_BACKEND, VIDEO_MAPPER, CONSUMER_BEARER all
 * return false — none should see drafts via consumer-facing relation paths
 * (Experience.locales, Video.locales).
 */
export function isEditorOrAdmin(user: Principal | null): boolean {
  return user?.role === "ADMIN" || user?.role === "EDITOR"
}
