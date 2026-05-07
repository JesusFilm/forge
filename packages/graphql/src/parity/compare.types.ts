/**
 * Compile-time isolation proof for `compareNormalizedRoutes`.
 *
 * Mirrors the dual-client `__tests__/dual-client.types.ts` pattern from
 * U3: a typecheck-only file (no `.test.ts` suffix; vitest skips per
 * the existing convention) that proves the function rejects raw
 * Strapi/admin response shapes at compile time. Only the shared
 * `NormalizedExperienceRoute` is acceptable.
 *
 * The `@ts-expect-error` directives make these proofs fail typecheck
 * if the rejection ever stops working.
 */

import { compareNormalizedRoutes } from "./compare"
import type { NormalizedExperienceRoute } from "./shared-shape"

// A raw Strapi-shaped response — typical GraphQL query result with
// `experiences[]` and per-block `__typename` fields. The shared
// `NormalizedExperienceRoute` carries `id`, `slug`, `locale`, `blocks`
// at the top level — different by design.
type RawStrapiResponse = {
  experiences: ReadonlyArray<{
    documentId: string
    slug: string
    blocks: ReadonlyArray<{ __typename: string }>
  }>
}

// A raw admin-shaped response — `experienceBySlug` returns a single
// `ExperienceLocale` with opaque JSON `blocks`.
type RawAdminResponse = {
  experienceBySlug: {
    id: string
    slug: string
    blocks: unknown
  } | null
}

declare const strapiRaw: RawStrapiResponse
declare const adminRaw: RawAdminResponse
declare const strapiNormalized: NormalizedExperienceRoute
declare const adminNormalized: NormalizedExperienceRoute

// Allowed: both inputs are NormalizedExperienceRoute.
compareNormalizedRoutes(strapiNormalized, adminNormalized, {
  urlLocale: "en",
})

// @ts-expect-error — raw Strapi shape lacks NormalizedExperienceRoute fields.
compareNormalizedRoutes(strapiRaw, adminNormalized, { urlLocale: "en" })

// @ts-expect-error — raw admin shape lacks NormalizedExperienceRoute fields.
compareNormalizedRoutes(strapiNormalized, adminRaw, { urlLocale: "en" })

// @ts-expect-error — both raw is rejected.
compareNormalizedRoutes(strapiRaw, adminRaw, { urlLocale: "en" })
