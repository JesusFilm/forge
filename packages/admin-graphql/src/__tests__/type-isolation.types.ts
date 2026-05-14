/**
 * Compile-time guard that Strapi-shape types from `@forge/graphql` and
 * admin-shape types from `@forge/admin-graphql` are NOT cross-assignable.
 *
 * This file has no `.test.ts` suffix; vitest skips it. It runs as part of
 * `pnpm --filter @forge/admin-graphql typecheck`.
 *
 * Mechanism: each factory produces documents whose Result/Fragment/Variables
 * types derive from THAT factory's introspection. When the queries select
 * schema-exclusive fields (`bibleBook` / `documentId` / `publishedAt` are
 * Strapi-only; `experienceBySlug` / `ExperienceLocale` are admin-only), the
 * shapes have disjoint property names and TS's structural typing rejects the
 * cross-assignment.
 *
 * IMPORTANT — query selection rule:
 *   The negative cases below cross-assign types derived from queries
 *   referencing schema-exclusive fields. Do NOT swap to queries selecting
 *   fields shared between both schemas — two structurally-identical shapes
 *   WOULD be assignable, the `@ts-expect-error` directives would become
 *   unused, and typecheck would fail "for the wrong reason." A future
 *   contributor "fixing" the unused directive then deletes the guard.
 *   Always pick query pairs where at least one selected field exists on
 *   only one side.
 *
 * What this does NOT exercise:
 *   `as` casts. Casting an admin value to `StrapiData` via `as` bypasses the
 *   structural check by design. The new package's CLAUDE.md documents this
 *   gap.
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
} from "@forge/graphql"

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
// Admin-only fragment — references admin's ExperienceLocale type.
// ──────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const ADMIN_FRAGMENT = adminGraphql(`
  fragment AdminExperienceLocaleFields on ExperienceLocale {
    id
    slug
  }
`)
type AdminFragment = AdminFragmentOf<typeof ADMIN_FRAGMENT>

declare const strapiValue: StrapiData
declare const adminValue: AdminData
declare const strapiVars: StrapiVars
declare const adminVars: AdminVars
declare const strapiFragmentValue: StrapiFragment
declare const adminFragmentValue: AdminFragment

// Positive cases: same-schema assignments compile clean. NO suppression
// directives here — if one sneaks in, typecheck fails because the directive
// is "unused" (no error to catch).
const _strapiResultToStrapi: StrapiData = strapiValue
const _adminResultToAdmin: AdminData = adminValue
const _strapiVarsToStrapi: StrapiVars = strapiVars
const _adminVarsToAdmin: AdminVars = adminVars
const _strapiFragmentToStrapi: StrapiFragment = strapiFragmentValue
const _adminFragmentToAdmin: AdminFragment = adminFragmentValue

// Negative cases: cross-schema assignments must fail. If the error is
// missing (shapes happen to overlap structurally), the directive becomes
// unused and typecheck fails.

// @ts-expect-error — Strapi's { bibleBook: ... } is not assignable to admin's { experienceBySlug: ... }.
const _strapiResultToAdmin: AdminData = strapiValue

// @ts-expect-error — admin's { experienceBySlug: ... } is not assignable to Strapi's { bibleBook: ... }.
const _adminResultToStrapi: StrapiData = adminValue

// @ts-expect-error — Strapi's { documentId, publishedAt } fragment doesn't include admin's ExperienceLocale fields.
const _strapiFragmentToAdmin: AdminFragment = strapiFragmentValue

// @ts-expect-error — admin's { id, slug } ExperienceLocale fragment doesn't include Strapi's BibleBook fields.
const _adminFragmentToStrapi: StrapiFragment = adminFragmentValue

// @ts-expect-error — Strapi's variables shape ($documentId: ID!) is not assignable to admin's ($locale: String!, $slug: String!).
const _strapiVarsToAdmin: AdminVars = strapiVars

// @ts-expect-error — admin's variables shape is not assignable to Strapi's single-arg shape.
const _adminVarsToStrapi: StrapiVars = adminVars

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
