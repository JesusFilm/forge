import { adminGraphql, adminWatchExperienceFragment } from "@forge/graphql"

// =============================================================================
// U5 (feat-104) — admin experienceBySlug operation
//
// Built via the adminGraphql() factory (NOT graphql() — that targets
// Strapi's schema). Selection set composes the shared
// `adminWatchExperienceFragment` exported from `@forge/graphql` so the
// admin schema's typed [ExperienceBlock!]! union is unpacked correctly
// after PR-A's blocks-as-typed-union change. Post-PR-A, selecting
// `blocks` as an opaque scalar (the U5 launch shape) no longer
// typechecks — every block kind needs an inline `... on <Block>`
// spread, supplied by the shared root fragment.
//
// Note: admin's schema field is `metaDescription`, not `description`.
// The parity bridge remaps to `description` before invoking
// normalizeAdmin (see apps/web/src/lib/parity-bridge.ts).
//
// Retire alongside the rest of U5's scaffolding. See:
//   apps/web/src/lib/content-api-mode.ts (deletion checklist)
// =============================================================================

export const adminExperienceBySlugOperation = adminGraphql(
  `
    query GetAdminExperienceBySlug($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        ...AdminWatchExperience
      }
    }
  `,
  [adminWatchExperienceFragment],
)
