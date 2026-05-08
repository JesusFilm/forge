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
  | "read:media-assets"
  | "read:reference"
  | "access:manager"
  // Write scopes (admin-write on Core-sourced is intentionally restricted)
  | "write:experiences"
  | "write:videos"
  | "write:media-assets"
  | "write:scene-embeddings"
  | "write:transcript-embeddings"
  | "write:experience-content-dump"
  // feat-119 PR2 — admin → manager outbound enrichment trigger.
  // Admin's `triggerManagerEnrichment` mutation gates on this key;
  // the mutation forwards the call to apps/manager's
  // `/api/admin-trigger/{scene-analysis,transcript}` endpoint.
  | "write:manager-enrichment-trigger"
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
  "read:media-assets": "EDITOR",
  // Reference data is public-shape; PUBLIC may read.
  "read:reference": "PUBLIC",
  // Manager app access is deliberately narrower than Admin access.
  // Any authenticated Admin account can be allowed into Manager-facing
  // contracts, but unauthenticated and bearer workflow callers cannot.
  "access:manager": "VIEWER",
  // Editor writes
  "write:experiences": "EDITOR",
  // Core-sourced; only ADMIN may override (also flips source='manager').
  "write:videos": "ADMIN",
  "write:media-assets": "EDITOR",
  // Derived-column trigger (scene-embedding backfill). ADMIN-only.
  "write:scene-embeddings": "ADMIN",
  // Derived-column trigger (transcript-embedding backfill). ADMIN-only.
  "write:transcript-embeddings": "ADMIN",
  // Experience content dump from cms (R3 of the admin migration playbook).
  // ADMIN-only because it overwrites admin-side ExperienceLocale rows from
  // the cms snapshot — must not be invokable by EDITOR sessions.
  "write:experience-content-dump": "ADMIN",
  // feat-119 PR2 — admin → manager outbound enrichment trigger.
  // ADMIN-only at the editorial-tier ladder; the bearer-mintable
  // `WORKFLOW_TRIGGER` role is also granted via the per-key allowlist
  // below so apps/manager can in turn call BACK to admin in the
  // existing reverse direction without the new key piggybacking on
  // that path.
  "write:manager-enrichment-trigger": "ADMIN",
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
 * bearer-auth path is for service-to-service trigger calls (apps/manager
 * → admin's embed-backfill mutations and manager-scoped backend read/job
 * contracts), NOT a generic admin session.
 *
 * **Adding a key here widens the bearer caller's blast radius.** It also
 * widens the manager proxy's reach: any user with the Strapi "Manager"
 * role (or a holder of `MANAGER_API_KEY`) who can hit
 * `apps/manager/src/app/api/admin-embeds/*` will gain access to whatever
 * mutation that key gates. Add a key here only when you have explicitly
 * decided that every Manager-tier service key should be able to invoke that
 * contract. The narrow allowlist is the only narrowing mechanism — the
 * editorial tier ladder is bypassed for this role.
 */
const WORKFLOW_TRIGGER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "access:manager",
  "write:scene-embeddings",
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
