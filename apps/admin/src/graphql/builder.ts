// Pothos SchemaBuilder — single source of truth for the GraphQL schema.
//
// Unit 3 wires three plugins:
//   - Prisma plugin: read-side relation resolution via `...query` passthrough.
//     Nested `t.relation` calls collapse into a single Prisma `findMany` so
//     `{ ping { children { label } } }` issues one SQL JOIN, not N+1.
//   - Scope-auth plugin: declarative role + `hasPermission` scopes applied at
//     type or field level. Runs BEFORE resolvers execute.
//   - Error plugin (optional, not wired in spike): surfaces typed user errors.
//
// Types re-opened later:
//   - Context: Unit 6 adds `services` + per-request DataLoader instances.
//   - AuthScopes: Unit 6 adds `tier` + finer `hasPermission` variants.
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import SchemaBuilder from "@pothos/core"
import PrismaPlugin from "@pothos/plugin-prisma"
import ScopeAuthPlugin from "@pothos/plugin-scope-auth"
import type PrismaTypes from "@pothos/plugin-prisma/generated"
import { Prisma } from "@prisma/client"
import { prisma } from "@/db/client"
import type { Loaders } from "@/graphql/loaders"
import type { Services } from "@/services"
import { hasPermission, type PermissionKey } from "@/auth/permissions"
import type { Role, Principal } from "@/auth/principal"

// Re-export so existing consumers (`@/graphql/builder` Role/Principal imports)
// keep working without a sweep.
export type { Role, Principal } from "@/auth/principal"

export type ContextShape = {
  /** Null represents PUBLIC (unauthenticated). */
  user: Principal | null
  /** Original request — used by rate limiter for IP extraction. */
  request: Request
  /** Stable prisma client reference (Unit 2 singleton). */
  prisma: typeof prisma
  /**
   * Request-start snapshot of the category-rail activation marker. Captured
   * before GraphQL row reads so a request never combines a stale row with a
   * newer marker observation.
   */
  watchHomeCategoryRailRolloutCompleted: boolean
  /**
   * Per-request DataLoader instances. Used by services that need to
   * hydrate by id outside the Pothos `...query` happy path (e.g. the
   * vector-search hydration pattern returning IDs from raw SQL).
   * Fresh per request — never cache across principals.
   */
  loaders: Loaders
  /** Domain services. Resolvers delegate mutations here; services own
   * Zod validation, ABAC checks, and Prisma calls. */
  services: Services
}

export type AuthScopesShape = {
  /** Always true — opt-in PUBLIC access. Used on anonymous-readable fields. */
  public: boolean
  /** True when `user` is non-null regardless of role. */
  loggedIn: boolean
  /**
   * Parametric role gate: `authScopes: { role: 'ADMIN' }` consults the
   * request principal and resolves to a boolean.
   */
  role: Role
  /**
   * Permission key consulted via `/src/auth/permissions.ts`. Constrained
   * to `PermissionKey` so that adding a new scope-auth gate forces a
   * matrix entry to be added at the same time (TypeScript fails to
   * compile if the literal isn't a known key).
   */
  hasPermission: PermissionKey
}

export const builder = new SchemaBuilder<{
  Context: ContextShape
  AuthScopes: AuthScopesShape
  PrismaTypes: PrismaTypes
  Scalars: {
    /**
     * Generic JSON scalar. Unit 4 uses it for localized `name` maps and
     * Experience block arrays. Writes are validated upstream (Zod at the
     * service boundary); reads pass the stored JSON through unchanged.
     */
    JSON: { Input: unknown; Output: unknown }
  }
}>({
  plugins: [ScopeAuthPlugin, PrismaPlugin],
  scopeAuth: {
    // Sync callback — nothing here awaits. Pothos supports async scopes
    // but paying a promise allocation per request for a purely synchronous
    // map is waste. Switch to `async` the moment any scope needs I/O.
    authScopes: (ctx) => ({
      public: true,
      loggedIn: ctx.user !== null,
      // Parametric scopes MUST be functions that take the scope argument
      // and return boolean.
      role: (expected) => (ctx.user?.role ?? "PUBLIC") === expected,
      // Permission keys resolve through the central matrix in
      // `/src/auth/permissions.ts`. The matrix is tier-only; ABAC
      // (ownership / state) checks live in service code via the named
      // helpers (canEditExperience, etc.) and run at the service layer
      // after the entity has been loaded.
      hasPermission: (key) => hasPermission(ctx.user, key),
    }),
  },
  prisma: {
    client: () => prisma,
    // Prisma DMMF is required so Pothos knows the schema shape at build time.
    dmmf: Prisma.dmmf,
    filterConnectionTotalCount: true,
  },
})

// Root types. Feature files extend via builder.queryFields / builder.mutationFields.
builder.queryType({})
builder.mutationType({})
