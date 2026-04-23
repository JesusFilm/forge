// Shared identity types — kept in a neutral module so both
// `src/graphql/builder.ts` and `src/auth/permissions.ts` can import without
// creating a circular module dependency.
//
// `Principal` represents who is making a request. `null` represents the
// PUBLIC tier (unauthenticated). Logged-in principals carry a stable id
// and a role; SYSTEM workflows use `id: null, role: 'SYSTEM'`.
//
// Per Unit 6 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

export type Role = "ADMIN" | "EDITOR" | "VIEWER" | "PUBLIC" | "SYSTEM"

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
