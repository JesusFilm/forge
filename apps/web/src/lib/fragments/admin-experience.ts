import { adminGraphql } from "@forge/graphql"

// =============================================================================
// U5 (feat-104) — admin experienceBySlug operation
//
// Built via the adminGraphql() factory (NOT graphql() — that targets
// Strapi's schema). Selection set covers every field on ExperienceLocale
// the parity bridge needs: id / slug / locale / title / metaDescription /
// ogImageUrl / ogTitle / ogDescription / pathSegment / blocks (JSON
// scalar — block-shape validation happens downstream in normalizeAdmin
// via @forge/admin/domain/blocks BlocksSchema).
//
// Note: admin's schema field is `metaDescription`, not `description`.
// The parity bridge remaps to `description` before invoking
// normalizeAdmin (see apps/web/src/lib/parity-bridge.ts).
//
// Retire alongside the rest of U5's scaffolding. See:
//   apps/web/src/lib/content-api-mode.ts (deletion checklist)
// =============================================================================

export const adminExperienceBySlugOperation = adminGraphql(`
  query GetAdminExperienceBySlug($locale: String!, $slug: String!) {
    experienceBySlug(locale: $locale, slug: $slug) {
      id
      slug
      locale
      title
      metaDescription
      ogImageUrl
      ogTitle
      ogDescription
      pathSegment
      blocks
    }
  }
`)
