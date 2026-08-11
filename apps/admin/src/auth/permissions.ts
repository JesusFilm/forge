// Central permission system for the admin app.
//
// Two layers:
//
// 1. **`hasPermission(user, key)`** — coarse-grained, parametric. Used by
//    Pothos scope-auth (`authScopes: { hasPermission: 'read:experiences' }`).
//    Resolves a permission key to a boolean based on the principal's role
//    tier. NO entity context — this is "is this principal allowed to
//    attempt the operation at all?"
//
// 2. **Named ABAC functions** (`canEditExperience(user, experience)`, etc.)
//    — fine-grained, accept the entity in question. Used by service
//    methods at the top of every mutation. Encode ownership and state-
//    based rules (e.g. EDITOR can only update content they own).
//
// Service-layer rule (enforced in Unit 7 services):
//   1. Resolver dispatches to service with `{ user, input }`
//   2. Service first calls a named ABAC function from this module
//   3. If false → throw ForbiddenError
//   4. Only then perform the Prisma operation
//
// The split exists because scope-auth runs before resolvers (no entity
// loaded yet) so it can only check tier; ABAC needs the entity, so it
// runs at the service layer where the entity has been fetched.
//
// Per Unit 6 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import type { LocaleStatus } from "@prisma/client"
import type { Role, Principal } from "@/auth/principal"

// -----------------------------------------------------------------------------
// Permission key registry — kept narrow on purpose. Add a key when a new
// scope-auth annotation needs it. Keys are dot-separated (`<verb>:<scope>`).
// -----------------------------------------------------------------------------

/**
 * All permission keys consultable via `hasPermission`. Adding a new key
 * also requires extending the `permissionMatrix` below — TypeScript will
 * fail to compile if a key is added here without a matrix entry.
 */
export type PermissionKey =
  // Read scopes
  | "read:experiences"
  | "read:videos"
  | "read:video-metadata"
  | "read:video-mapper-catalog"
  | "read:media-assets"
  | "read:reference"
  | "access:manager"
  | "read:manager-read-models"
  | "read:manager-seo"
  // Write scopes (admin-write on Core-sourced is intentionally restricted)
  | "write:experiences"
  | "write:videos"
  | "write:media-assets"
  | "write:transcript-embeddings"
  | "write:experience-embeddings"
  | "write:watch-events"
  // Own-data watch-progress scopes for the MOBILE_USER principal. "own"
  // is enforced at the service layer: identity comes from the verified
  // token subject, never from arguments (R13).
  | "read:watch-progress:own"
  | "write:watch-progress:own"
  | "delete:watch-progress:own"
  // feat-119 PR2 — admin → manager outbound enrichment trigger.
  // Admin's `triggerManagerEnrichment` mutation gates on this key;
  // the mutation forwards the call to apps/manager's
  // `/api/admin-trigger/{scene-analysis,transcript}` endpoint.
  | "write:manager-enrichment-trigger"
  | "write:manager-jobs"
  // Lifecycle scopes (publish / archive ExperienceLocale, etc.)
  | "publish:experiences"
  | "archive:experiences"
  | "delete:media-assets"
  // Workflow / system scopes
  | "system:trigger-workflow"
  | "system:write-derived"
  // Admin override
  | "admin:all"

/**
 * The minimum role tier required to be granted a permission key.
 * Higher tiers automatically inherit lower-tier permissions via the
 * tier-comparison helper below. PUBLIC is the lowest tier; SYSTEM is
 * a separate axis (workflow-only) that never crosses with editorial roles.
 */
const permissionMatrix: Record<PermissionKey, MinTier> = {
  // Anyone can read published content; auth required only for drafts.
  // The HasPermission check passes for any logged-in tier; ABAC functions
  // narrow to "is the entity actually published?" or "do I own this draft?"
  "read:experiences": "VIEWER",
  "read:videos": "VIEWER",
  // feat-125 — manager's `/api/admin-trigger/*` endpoints look up
  // video dispatch fields (muxAssetId, subtitleUrl, label,
  // primaryLanguage.bcp47) by coreId via admin's `videosByCoreIds`
  // query, replacing the Strapi GraphQL call. VIEWER-tier at the
  // editorial ladder mirrors `read:videos`; the load-bearing
  // gating happens via the `WORKFLOW_TRIGGER_PERMISSIONS` allowlist
  // below so manager's bearer call is the intended caller.
  "read:video-metadata": "VIEWER",
  // YTM-002 — whole-catalog mapper sync projection, including media URLs.
  // Human ADMINs may inspect it, and the dedicated VIDEO_MAPPER bearer role
  // below may page it for sync. Do not reuse `read:video-metadata`: that key
  // is VIEWER-tier and workflow-bearer-callable for manager lookups.
  "read:video-mapper-catalog": "ADMIN",
  "read:media-assets": "EDITOR",
  // Reference data is public-shape; PUBLIC may read.
  "read:reference": "PUBLIC",
  // Manager panel and Manager backend contracts are gated below, not by
  // the editorial role ladder.
  "access:manager": "PUBLIC",
  "read:manager-read-models": "PUBLIC",
  "read:manager-seo": "PUBLIC",
  // Editor writes
  "write:experiences": "EDITOR",
  // Core-sourced; only ADMIN may override (also flips source='manager').
  "write:videos": "ADMIN",
  "write:media-assets": "EDITOR",
  // Derived-column trigger (transcript-embedding backfill). ADMIN-only.
  "write:transcript-embeddings": "ADMIN",
  // Experience-embedding backfill (admin-native). Enumerates
  // ExperienceLocale rows and dispatches `runExperienceEmbedding` per
  // locale. ADMIN-only at the editorial-tier ladder; bearer-callable
  // from CLIs via the per-key allowlist below (symmetric with R1/R2
  // backfill keys so `pnpm run-embeds --pipeline=experience` can mint
  // a WORKFLOW_TRIGGER principal without standing up admin's full
  // session-cookie auth flow).
  "write:experience-embeddings": "ADMIN",
  "write:watch-events": "ADMIN",
  // ADMIN-only on the editorial ladder (operational override); the
  // intended callers are MOBILE_USER and WEB_USER (TV device-grant
  // tokens introspect as WEB_USER) via their per-key allowlists below.
  "read:watch-progress:own": "ADMIN",
  "write:watch-progress:own": "ADMIN",
  "delete:watch-progress:own": "ADMIN",
  // feat-119 PR2 — admin → manager outbound enrichment trigger.
  // ADMIN-only at the editorial-tier ladder; the bearer-mintable
  // `WORKFLOW_TRIGGER` role is also granted via the per-key allowlist
  // below so apps/manager can in turn call BACK to admin in the
  // existing reverse direction without the new key piggybacking on
  // that path.
  "write:manager-enrichment-trigger": "ADMIN",
  "write:manager-jobs": "PUBLIC",
  // Lifecycle
  "publish:experiences": "EDITOR",
  "archive:experiences": "EDITOR",
  "delete:media-assets": "ADMIN",
  // System / workflow
  "system:trigger-workflow": "ADMIN",
  "system:write-derived": "SYSTEM",
  // ADMIN catch-all
  "admin:all": "ADMIN",
}

// -----------------------------------------------------------------------------
// Tier comparison helpers
// -----------------------------------------------------------------------------

/**
 * Editorial tiers ordered low → high. `SYSTEM` is excluded from the
 * comparison ladder — workflow principals satisfy SYSTEM-scoped
 * permissions only, never editorial ones.
 */
const EDITORIAL_LADDER = ["PUBLIC", "VIEWER", "EDITOR", "ADMIN"] as const
type EditorialTier = (typeof EDITORIAL_LADDER)[number]
type MinTier = EditorialTier | "SYSTEM"

function editorialRank(role: Role): number {
  const idx = EDITORIAL_LADDER.indexOf(role as EditorialTier)
  return idx === -1 ? -1 : idx
}

function principalRole(user: Principal | null): Role {
  return user?.role ?? "PUBLIC"
}

function meetsTier(role: Role, min: MinTier): boolean {
  // ADMIN is the operational override — satisfies any tier including
  // SYSTEM-only gates (matches `canWriteDerived` behavior; lets ADMIN
  // run a workflow manually for incident response).
  if (role === "ADMIN") return true
  // SYSTEM-only gates: only the SYSTEM workflow principal qualifies.
  if (min === "SYSTEM") return role === "SYSTEM"
  // SYSTEM never satisfies editorial tiers — workflows are isolated
  // from editorial responsibilities by default.
  if (role === "SYSTEM") return false
  // WORKFLOW_TRIGGER is gated by `WORKFLOW_TRIGGER_PERMISSIONS` in
  // `hasPermission` directly; it never satisfies tier-based checks.
  if (role === "WORKFLOW_TRIGGER") return false
  // MANAGER_BACKEND is gated by `MANAGER_BACKEND_PERMISSIONS`; it never
  // satisfies human panel access or editorial tier checks.
  if (role === "MANAGER_BACKEND") return false
  // VIDEO_MAPPER is gated by `VIDEO_MAPPER_PERMISSIONS`; it never satisfies
  // human panel access or editorial tier checks.
  if (role === "VIDEO_MAPPER") return false
  // CONSUMER_BEARER is gated by `CONSUMER_BEARER_PERMISSIONS` (empty set)
  // in `hasPermission` via early-return; it never satisfies tier-based
  // checks. The bearer's sole purpose is rate-limit bucketing, not
  // permission granting.
  if (role === "CONSUMER_BEARER") return false
  if (role === "WEB_USER") return false
  if (role === "MOBILE_USER") return false
  return editorialRank(role) >= editorialRank(min)
}

// -----------------------------------------------------------------------------
// hasPermission — used by Pothos scope-auth via the `hasPermission` scope.
// -----------------------------------------------------------------------------

/**
 * Permission keys the request-bound `WORKFLOW_TRIGGER` principal is
 * allowed to satisfy. This role is minted by `createContext` when an
 * incoming request carries a valid bearer key matching
 * `WORKFLOW_API_KEYS`. It is intentionally narrower than ADMIN — the
 * bearer-auth path is for service-to-service trigger calls, NOT a
 * generic admin session.
 *
 * **Adding a key here widens the bearer caller's blast radius.** It also
 * widens the manager proxy's reach: any user with the Strapi "Manager"
 * role (or a holder of `MANAGER_API_KEY`) who can hit
 * `apps/manager/src/app/api/admin-embeds/*` will gain access to whatever
 * mutation that key gates. Add a key here only when you have explicitly
 * decided that every Manager-tier identity should be able to invoke that
 * mutation. The narrow allowlist is the only narrowing mechanism — the
 * editorial tier ladder is bypassed for this role.
 */
const WORKFLOW_TRIGGER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "write:transcript-embeddings",
  // feat-119 PR2: the `pnpm trigger-enrichment` CLI authenticates
  // with `WORKFLOW_API_KEYS` (mints `WORKFLOW_TRIGGER`) when an
  // operator pipes PR1's `missingArtifacts` projection into the
  // outbound trigger. Granting it here keeps the CLI path symmetric
  // with the embed-backfill triggers above. The opposite direction
  // (manager → admin) does NOT acquire any new reach: there is no
  // manager-side REST proxy forwarding to this mutation, so a
  // Manager-tier identity cannot pivot through this key.
  "write:manager-enrichment-trigger",
  // Admin-native experience-embedding backfill. Granted to
  // WORKFLOW_TRIGGER so `pnpm run-embeds --pipeline=experience`
  // (the local-dev CLI shim) can dispatch via bearer auth without
  // a session cookie. Symmetric with the scene/transcript embed
  // backfill keys above. There is no manager-side REST proxy
  // forwarding to this mutation, so a Manager-tier identity does
  // NOT gain reach through this key today.
  "write:experience-embeddings",
  // feat-125 — manager's admin-trigger CMS-replacement lookup
  // (`/api/admin-trigger/{scene-analysis,transcript}` calls back
  // to admin's `videosByCoreIds` query to resolve dispatch fields).
  // Read on already-published video metadata — same shape as
  // `read:videos` semantically; widening blast radius by a read.
  // Reuses `ADMIN_EMBED_TRIGGER_API_KEY` as the calling bearer so
  // no new env coordination is required.
  "read:video-metadata",
])

/**
 * Permission keys the request-bound `CONSUMER_BEARER` principal is
 * allowed to satisfy. **Intentionally empty.** The bearer's sole
 * purpose is to bucket consumer SSR traffic in admin's rate-limit
 * identifyFn — it grants NO permissions beyond PUBLIC. Adding any
 * permission to this set is CI-asserted to fail across two surfaces:
 *
 *   1. `permissions.test.ts` enumerates every `PermissionKey` and
 *      asserts `hasPermission(CONSUMER_BEARER_PRINCIPAL("any"), key)
 *      === false`.
 *   2. The same test asserts `CONSUMER_BEARER` is NOT a member of
 *      `WORKFLOW_TRIGGER_PERMISSIONS`-style sets and that
 *      `WEB_ADMIN_API_KEYS !== WORKFLOW_API_KEYS`.
 *
 * If a future plan needs the bearer to satisfy a real permission, that
 * is a brand-new role, not a widening of this one. The empty-set
 * invariant is the load-bearing security boundary.
 */
const CONSUMER_BEARER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set()

const MANAGER_BACKEND_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "read:manager-read-models",
  "read:manager-seo",
  "write:manager-jobs",
])

const VIDEO_MAPPER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "read:video-mapper-catalog",
])

/**
 * WEB_USER is minted by Auth-token introspection for BOTH web watch
 * sessions and TV device-grant sessions (the `jfp_tv_*` client ids in
 * `web-user-token.ts`). The three own-data watch-progress scopes joined
 * `write:watch-events` for feat-322's TV Continue Watching account merge
 * — own-data only: the subject comes from the introspected token (R13),
 * never from arguments, so this grants a signed-in viewer access to
 * exactly their own rows. Adding any NON-own-data key here widens what a
 * verified user token can reach; the enumerating test in
 * `permissions.test.ts` pins the set.
 */
const WEB_USER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "write:watch-events",
  "read:watch-progress:own",
  "write:watch-progress:own",
  "delete:watch-progress:own",
])

/**
 * Permission keys the request-bound `MOBILE_USER` principal is allowed
 * to satisfy — exactly the three own-data watch-progress scopes.
 * Mobile still carries no event-write permission in v1 and no content
 * or editorial scope. (Until feat-322's TV merge these three scopes
 * were MOBILE_USER-exclusive; WEB_USER now shares them — see above.)
 * Adding a key here widens what a verified mobile JWT can reach; the
 * enumerating test in `permissions.test.ts` pins the set.
 */
const MOBILE_USER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "read:watch-progress:own",
  "write:watch-progress:own",
  "delete:watch-progress:own",
])

const MANAGER_MEMBERSHIP_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "access:manager",
])

/**
 * Resolve a permission key to a boolean for the given principal.
 * Tier-only — does not consider entity ownership or state.
 *
 * Service code should generally use the named ABAC helpers below for
 * mutations. `hasPermission` is for Pothos scope-auth gates that fire
 * before any entity has been loaded.
 */
export function hasPermission(
  user: Principal | null,
  key: PermissionKey,
): boolean {
  const role = principalRole(user)
  // WORKFLOW_TRIGGER bypasses the editorial tier ladder entirely and is
  // gated by an explicit per-key allowlist instead. This keeps the
  // bearer-auth path's blast radius surgical — adding the role to the
  // editorial ladder would silently grant access to every existing
  // ADMIN-only mutation.
  if (role === "WORKFLOW_TRIGGER") {
    return WORKFLOW_TRIGGER_PERMISSIONS.has(key)
  }
  if (role === "MANAGER_BACKEND") {
    return MANAGER_BACKEND_PERMISSIONS.has(key)
  }
  if (role === "VIDEO_MAPPER") {
    return VIDEO_MAPPER_PERMISSIONS.has(key)
  }
  if (role === "WEB_USER") {
    return WEB_USER_PERMISSIONS.has(key)
  }
  if (role === "MOBILE_USER") {
    return MOBILE_USER_PERMISSIONS.has(key)
  }
  // CONSUMER_BEARER's permission set is intentionally empty; this
  // early-return makes the contract explicit at the call site so a
  // reader doesn't have to derive "no permission keys granted" from
  // `meetsTier`'s tier-only ladder. Adding a key to
  // CONSUMER_BEARER_PERMISSIONS is a CI-fail surface — see the
  // assertions in `permissions.test.ts`.
  if (role === "CONSUMER_BEARER") {
    return CONSUMER_BEARER_PERMISSIONS.has(key)
  }
  if (MANAGER_BACKEND_PERMISSIONS.has(key)) {
    return false
  }
  if (MANAGER_MEMBERSHIP_PERMISSIONS.has(key)) {
    return user?.managerRole === "OPERATOR"
  }
  const min = permissionMatrix[key]
  return meetsTier(role, min)
}

// -----------------------------------------------------------------------------
// Named ABAC helpers — used by service mutations.
//
// Convention: every function accepts (user, entity) and returns boolean.
// Inputs use `Pick<Entity, 'fieldsWeRead'>` so callers can pass partial
// rows (avoids forcing a full row load when only a couple of fields matter
// for the auth decision).
// -----------------------------------------------------------------------------

type ExperienceForAuth = {
  ownerId: string | null
  archivedAt: Date | null
}

type ExperienceLocaleForAuth = {
  status: LocaleStatus
  experience: ExperienceForAuth
}

/**
 * Read access to a specific Experience.
 *  - ADMIN: any
 *  - EDITOR: any (they need to discover content they don't own)
 *  - VIEWER: published-only (i.e. has at least one PUBLISHED locale —
 *    caller decides whether to load locales; this function checks the
 *    canonical's archive state only)
 *  - PUBLIC: published-only and not archived
 *
 * For locale-specific publish state, use `canViewExperienceLocale`.
 */
export function canViewExperience(
  user: Principal | null,
  experience: Pick<ExperienceForAuth, "archivedAt">,
): boolean {
  const role = principalRole(user)
  if (role === "ADMIN" || role === "EDITOR") return true
  // Archived content is hidden from VIEWER and PUBLIC.
  return experience.archivedAt === null
}

/**
 * Read access to a specific ExperienceLocale row.
 *  - ADMIN: any
 *  - EDITOR: any (they can read each other's drafts during review)
 *  - VIEWER: published only
 *  - PUBLIC: published only
 */
export function canViewExperienceLocale(
  user: Principal | null,
  locale: Pick<ExperienceLocaleForAuth, "status">,
): boolean {
  const role = principalRole(user)
  if (role === "ADMIN" || role === "EDITOR") return true
  return locale.status === "PUBLISHED"
}

/**
 * Edit a canonical Experience (ownership transfer, archive, isTemplate
 * toggle). EDITOR can edit only Experiences they own; ADMIN can edit any.
 */
export function canEditExperience(
  user: Principal | null,
  experience: ExperienceForAuth,
): boolean {
  const role = principalRole(user)
  if (role === "ADMIN") return true
  if (role !== "EDITOR") return false
  if (experience.archivedAt !== null) return false
  if (user?.id == null) return false
  return experience.ownerId === user.id
}

/**
 * Edit an ExperienceLocale row (slug, blocks, title, etc. — content edits).
 * Same ownership rules as `canEditExperience` (locale inherits from
 * its parent Experience).
 */
export function canEditExperienceLocale(
  user: Principal | null,
  locale: ExperienceLocaleForAuth,
): boolean {
  return canEditExperience(user, locale.experience)
}

/**
 * Publish an ExperienceLocale (flip status to PUBLISHED).
 * Same rule as edit — ownership-gated for EDITOR, open for ADMIN.
 */
export function canPublishExperienceLocale(
  user: Principal | null,
  locale: ExperienceLocaleForAuth,
): boolean {
  return canEditExperienceLocale(user, locale)
}

/**
 * Archive an Experience. Shares edit rules: owner or ADMIN.
 * Idempotent if already archived (caller decides whether to reject
 * re-archive separately). Note that `canEditExperience` additionally
 * returns false for already-archived rows; archive re-entry is caller-
 * controlled, so we apply the same gate here on purpose — if an
 * Experience is already archived, the archive action is a no-op and
 * rejecting it at the auth layer is acceptable.
 */
export const canArchiveExperience = canEditExperience

/**
 * Edit a Video canonical row. ADMIN-only in v1 regardless of source:
 * Core-sourced rows are protected because Core is the upstream authority;
 * `source='manager'` rows are protected because in v1 no editorial tier
 * below ADMIN is trusted to mutate Video canonicals. When EDITOR-writable
 * Video fields are introduced, this helper gets a `VideoForAuth` argument
 * and branches on `video.source` / ownership.
 *
 * On first ADMIN edit the service layer also flips `source='core'` to
 * `'manager'` so future Core sync skips the row (see CLAUDE.md).
 */
export function canEditVideo(user: Principal | null): boolean {
  return principalRole(user) === "ADMIN"
}

/**
 * Workflow / system-only writes (e.g., the experience-embedding workflow
 * setting `ExperienceLocale.embedding`). The service layer must call this
 * before any workflow-derived column update; Sync writes use this too.
 */
export function canWriteDerived(user: Principal | null): boolean {
  const role = principalRole(user)
  return role === "SYSTEM" || role === "ADMIN"
}
