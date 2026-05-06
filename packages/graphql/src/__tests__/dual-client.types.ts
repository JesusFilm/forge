/**
 * Compile-time enforcement of AE1 (type isolation between Strapi and admin
 * factories).
 *
 * This file is NOT a runtime test runner file (no `.test.ts` suffix); vitest
 * skips it. It runs as part of `pnpm --filter @forge/graphql typecheck`.
 *
 * The test passes when:
 *   1. Same-schema assignments compile cleanly (positive cases).
 *   2. Cross-schema assignments fail with a TypeScript error caught by
 *      `@ts-expect-error` (negative cases).
 *
 * If a `@ts-expect-error` on a negative case is missing, TypeScript reports
 * the cross-schema assignment as a normal type error → typecheck fails.
 *
 * If a `@ts-expect-error` is accidentally placed on a positive case (same
 * schema), TypeScript reports the directive as unused → typecheck fails.
 *
 * Both failure modes prove the test is meaningful — it catches the real
 * isolation guarantee, not a vacuous tautology.
 *
 * IMPORTANT — query selection rule:
 *
 *   The two negative cases below cross-assign `ResultOf<...>` and
 *   `AdminResultOf<...>` shapes derived from queries against different root
 *   fields (`bibleBook` is a Strapi-only Query field; `experienceBySlug`
 *   is an admin-only Query field). The resulting shapes have NO overlapping
 *   property names, so structural typing rejects the cross-assignment.
 *
 *   DO NOT replace these queries with ones that select fields shared between
 *   the two schemas (e.g. `experiences { id }` on both sides). Two
 *   structurally-identical shapes WOULD be assignable to each other under
 *   TypeScript's structural typing, the `@ts-expect-error` directives would
 *   become unused, and typecheck would fail "for the wrong reason." A future
 *   contributor "fixing" the unused directive then deletes the test's actual
 *   guard. Always pick query pairs where at least one selected field exists
 *   on only one side.
 */

import { adminGraphql, type AdminResultOf } from "../admin"
import { graphql, type ResultOf } from "../graphql"

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

// Sample values cast through the type system to exercise assignability.
declare const strapiValue: StrapiData
declare const adminValue: AdminData

/* ─────────────────────────────────────────────────────────────────────────
 * Positive cases: same-schema assignments must compile clean. NO
 * suppression directives here — if one sneaks in, typecheck fails because
 * the directive is "unused" (no error to catch).
 * ─────────────────────────────────────────────────────────────────────── */

const _strapiToStrapi: StrapiData = strapiValue
const _adminToAdmin: AdminData = adminValue

/* ─────────────────────────────────────────────────────────────────────────
 * Negative cases: cross-schema assignments must fail. The suppression
 * directives below confirm a TypeScript error IS produced. If the error
 * is missing (because the shapes happen to overlap structurally), the
 * directive becomes unused and typecheck fails.
 * ─────────────────────────────────────────────────────────────────────── */

// @ts-expect-error — Strapi's { bibleBook: ... } is not assignable to admin's { experienceBySlug: ... } shape.
const _strapiToAdmin: AdminData = strapiValue

// @ts-expect-error — admin's { experienceBySlug: ... } is not assignable to Strapi's { bibleBook: ... } shape.
const _adminToStrapi: StrapiData = adminValue

// Suppress "unused" lints on the typed bindings — their existence is the
// point. This file is consumed by typecheck, not by the bundler or runtime.
void _strapiToStrapi
void _adminToAdmin
void _strapiToAdmin
void _adminToStrapi
