/**
 * Compile-time enforcement of AE1 (type isolation between Strapi and admin
 * factories).
 *
 * This file is NOT a runtime test runner file (no `.test.ts` suffix); vitest
 * skips it. It runs as part of `pnpm --filter @forge/graphql typecheck`.
 *
 * What this test exercises:
 *
 *   The `Result/Fragment/Variables`-shaped types derived from a query bound
 *   to one factory must NOT be assignable to the same-shaped types derived
 *   from the OTHER factory's query. The isolation is structural: each factory
 *   produces a document whose result/fragment/variables types are derived
 *   from THAT factory's introspection. When the queries reference
 *   schema-exclusive fields (see selection rule below), the resulting shapes
 *   have disjoint property names, and TS's structural typing rejects the
 *   cross-assignment.
 *
 *   `AdminResultOf` / `AdminFragmentOf` / `AdminVariablesOf` are aliases for
 *   the same gql.tada utilities under the bare names — there is NO nominal
 *   branding on the alias itself. The naming is a call-site readability
 *   convention, not an additional type-system enforcement.
 *
 * What this test does NOT exercise:
 *
 *   Factory-level query rejection. gql.tada's TS plugin parses each tagged
 *   template at compile time; a query referencing an unknown field produces
 *   an error variant of the document type. That variant does not raise a TS
 *   error at the const declaration site — you'd need to use the document
 *   with a typed consumer (e.g., a downstream typed `useQuery`) for the
 *   error to surface. Once consumer-app Apollo clients are wired in Unit 5,
 *   factory-rejection becomes observable through their typed call signatures.
 *
 *   `as` casts. Casting an admin value to `StrapiData` via `as` deliberately
 *   bypasses the structural check. AGENTS.md and CLAUDE.md document this
 *   gap; an ESLint rule against the specific cast shape is a follow-up.
 *
 * The test passes when:
 *   - Same-schema assignments compile cleanly (positive cases).
 *   - Cross-schema assignments fail with a TS error caught by `@ts-expect-error`.
 *
 * If a `@ts-expect-error` on a negative case is missing, TS reports the
 * cross-schema assignment as a normal type error → typecheck fails.
 *
 * If a `@ts-expect-error` is accidentally placed on a positive case (same
 * schema), TS reports the directive as unused → typecheck fails.
 *
 * Both failure modes prove the test is meaningful — it catches the real
 * structural-isolation guarantee, not a vacuous tautology.
 *
 * IMPORTANT — query selection rule:
 *
 *   The negative cases below cross-assign result/fragment/variables types
 *   derived from queries against schema-exclusive fields (`bibleBook` /
 *   `documentId` / `publishedAt` are Strapi-only; `experienceBySlug` /
 *   `ExperienceLocale` are admin-only). The resulting shapes have NO
 *   overlapping property names, so structural typing rejects the
 *   cross-assignment.
 *
 *   DO NOT replace these queries with ones that select fields shared between
 *   the two schemas. Two structurally-identical shapes WOULD be assignable
 *   under TS's structural typing, the `@ts-expect-error` directives would
 *   become unused, and typecheck would fail "for the wrong reason." A future
 *   contributor "fixing" the unused directive then deletes the test's actual
 *   guard. Always pick query pairs where at least one selected field exists
 *   on only one side.
 */

import {
  adminGraphql,
  type AdminFragmentOf,
  type AdminResultOf,
  type AdminVariablesOf,
} from "../admin"
import {
  graphql,
  type FragmentOf,
  type ResultOf,
  type VariablesOf,
} from "../graphql"

// ──────────────────────────────────────────────────────────────────────────
// Strapi-only query — `bibleBook(documentId)` is a Strapi root query;
// `documentId` is a Strapi-only field on the returned BibleBook type.
// ──────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const STRAPI_QUERY = graphql(`
  query StrapiBibleBook($documentId: ID!) {
    bibleBook(documentId: $documentId) {
      documentId
    }
  }
`)
type StrapiData = ResultOf<typeof STRAPI_QUERY>
type StrapiVars = VariablesOf<typeof STRAPI_QUERY>

// ──────────────────────────────────────────────────────────────────────────
// Strapi-only fragment — references the Strapi-only `documentId` field.
// ──────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const STRAPI_FRAGMENT = graphql(`
  fragment StrapiBibleBookFields on BibleBook {
    documentId
    publishedAt
  }
`)
type StrapiFragment = FragmentOf<typeof STRAPI_FRAGMENT>

// ──────────────────────────────────────────────────────────────────────────
// Admin-only query — `experienceBySlug(locale, slug)` is an admin root
// query; the returned ExperienceLocale type does not exist in Strapi.
// ──────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const ADMIN_QUERY = adminGraphql(`
  query AdminExperienceBySlug($locale: String!, $slug: String!) {
    experienceBySlug(locale: $locale, slug: $slug) {
      id
      slug
    }
  }
`)
type AdminData = AdminResultOf<typeof ADMIN_QUERY>
type AdminVars = AdminVariablesOf<typeof ADMIN_QUERY>

// ──────────────────────────────────────────────────────────────────────────
// Admin-only fragment — references admin's ExperienceLocale type, which
// does not exist on Strapi.
// ──────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const ADMIN_FRAGMENT = adminGraphql(`
  fragment AdminExperienceLocaleFields on ExperienceLocale {
    id
    slug
  }
`)
type AdminFragment = AdminFragmentOf<typeof ADMIN_FRAGMENT>

// Sample values cast through the type system to exercise assignability.
declare const strapiValue: StrapiData
declare const adminValue: AdminData
declare const strapiVars: StrapiVars
declare const adminVars: AdminVars
declare const strapiFragmentValue: StrapiFragment
declare const adminFragmentValue: AdminFragment

/* ─────────────────────────────────────────────────────────────────────────
 * Mechanism 2 — Result-shape distinctness
 *
 * Positive cases: same-schema assignments must compile clean. NO
 * suppression directives here — if one sneaks in, typecheck fails because
 * the directive is "unused" (no error to catch).
 * ─────────────────────────────────────────────────────────────────────── */

const _strapiResultToStrapi: StrapiData = strapiValue
const _adminResultToAdmin: AdminData = adminValue
const _strapiVarsToStrapi: StrapiVars = strapiVars
const _adminVarsToAdmin: AdminVars = adminVars
const _strapiFragmentToStrapi: StrapiFragment = strapiFragmentValue
const _adminFragmentToAdmin: AdminFragment = adminFragmentValue

/* ─────────────────────────────────────────────────────────────────────────
 * Mechanism 2 — Result-shape distinctness
 *
 * Negative cases: cross-schema assignments must fail. The suppression
 * directives below confirm a TypeScript error IS produced. If the error
 * is missing (because the shapes happen to overlap structurally), the
 * directive becomes unused and typecheck fails.
 * ─────────────────────────────────────────────────────────────────────── */

// @ts-expect-error — Strapi's { bibleBook: ... } is not assignable to admin's { experienceBySlug: ... } shape.
const _strapiResultToAdmin: AdminData = strapiValue

// @ts-expect-error — admin's { experienceBySlug: ... } is not assignable to Strapi's { bibleBook: ... } shape.
const _adminResultToStrapi: StrapiData = adminValue

// @ts-expect-error — Strapi's { documentId, publishedAt } fragment shape doesn't include admin's ExperienceLocale fields.
const _strapiFragmentToAdmin: AdminFragment = strapiFragmentValue

// @ts-expect-error — admin's { id, slug } ExperienceLocale fragment doesn't include Strapi's BibleBook fields.
const _adminFragmentToStrapi: StrapiFragment = adminFragmentValue

// @ts-expect-error — Strapi's variables shape ($documentId: ID!) is not assignable to admin's ($locale: String!, $slug: String!).
const _strapiVarsToAdmin: AdminVars = strapiVars

// @ts-expect-error — admin's variables shape is not assignable to Strapi's single-arg shape.
const _adminVarsToStrapi: StrapiVars = adminVars

// Suppress "unused" lints on the typed bindings — their existence is the
// point. This file is consumed by typecheck, not by the bundler or runtime.
void _strapiResultToStrapi
void _adminResultToAdmin
void _strapiVarsToStrapi
void _adminVarsToAdmin
void _strapiFragmentToStrapi
void _adminFragmentToAdmin
void _strapiResultToAdmin
void _adminResultToStrapi
void _strapiFragmentToAdmin
void _adminFragmentToStrapi
void _strapiVarsToAdmin
void _adminVarsToStrapi
