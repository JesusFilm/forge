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

/**
 * Principal classes surfaced by context. Unit 6 turns these into full
 * `User`-aware objects plus a null PUBLIC tier.
 */
export type Role = "ADMIN" | "EDITOR" | "VIEWER" | "PUBLIC" | "SYSTEM"

export type Principal = {
  id: string | null
  role: Role
}

export type ContextShape = {
  /** Null represents PUBLIC (unauthenticated). */
  user: Principal | null
  /** Stable prisma client reference (Unit 2 singleton). */
  prisma: typeof prisma
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
   * Arbitrary permission string. Unit 6 wires this to a parametric
   * resolver that consults `/src/auth/permissions.ts`.
   */
  hasPermission: string
}

export const builder = new SchemaBuilder<{
  Context: ContextShape
  AuthScopes: AuthScopesShape
  PrismaTypes: PrismaTypes
}>({
  plugins: [ScopeAuthPlugin, PrismaPlugin],
  scopeAuth: {
    authScopes: async (ctx) => ({
      public: true,
      loggedIn: ctx.user !== null,
      // Parametric scopes MUST be functions that take the scope argument
      // and return boolean. Unit 6 replaces these stubs with real checks.
      role: (expected) => (ctx.user?.role ?? "PUBLIC") === expected,
      hasPermission: (_permission) =>
        ctx.user?.role === "ADMIN" || ctx.user?.role === "SYSTEM",
    }),
  },
  prisma: {
    client: () => prisma,
    // Prisma DMMF is required so Pothos knows the schema shape at build time.
    dmmf: Prisma.dmmf,
    filterConnectionTotalCount: true,
  },
})

// Root Query exists so feature files can extend it. Mutation is added in
// Unit 7 when the first mutation ships — GraphQL rejects empty object types.
builder.queryType({})
