/**
 * Per-diff-class hand-rolled fixtures.
 *
 * One fixture per known-bad scenario, each producing exactly the
 * expected diff entry on the corresponding channel. These fixtures
 * cover BRANCH SHAPE — production-faithful captured-from-live
 * fixtures live under `../captured/`. Both tiers exist per the
 * mocked-vs-real-contract-discipline learning.
 */

import type { NormalizedExperienceRoute } from "../../shared-shape"

function baseRoute(
  source: "strapi" | "admin",
  overrides: Partial<NormalizedExperienceRoute> = {},
): NormalizedExperienceRoute {
  return {
    id: source === "strapi" ? "doc-base" : "exp-loc-base",
    slug: "fixture-slug",
    locale: "en",
    title: "Fixture Title",
    description: null,
    ogImage: null,
    blocks: [],
    meta: {
      source,
      potentiallyTruncated: false,
      rawUrls: {},
    },
    ...overrides,
  }
}

// Structural class — admin missing a present-on-strapi field.
export const STRUCTURAL_MISSING_FIELD = {
  name: "structural-missing-field",
  strapi: baseRoute("strapi", {
    description: "present on strapi",
  }),
  admin: baseRoute("admin", {
    description: null, // missing-as-null, treated as absent
  }),
} as const

// Value class — same shape, differing scalar value.
export const VALUE_TITLE_MISMATCH = {
  name: "value-title-mismatch",
  strapi: baseRoute("strapi", { title: "Easter" }),
  admin: baseRoute("admin", { title: "Easter Story" }),
} as const

// Order class — same set of blocks, different order.
export const ORDER_BLOCKS_REORDERED = {
  name: "order-blocks-reordered",
  strapi: baseRoute("strapi", {
    blocks: [
      { kind: "text", id: "a", data: {} },
      { kind: "cta", id: "b", data: {} },
      { kind: "video", id: "c", data: {} },
    ] as unknown as NormalizedExperienceRoute["blocks"],
  }),
  admin: baseRoute("admin", {
    blocks: [
      { kind: "text", id: "a", data: {} },
      { kind: "video", id: "c", data: {} },
      { kind: "cta", id: "b", data: {} },
    ] as unknown as NormalizedExperienceRoute["blocks"],
  }),
} as const

// Semantic class — strapi resolved to a different locale than the URL.
export const SEMANTIC_LOCALE_FALLTHROUGH = {
  name: "semantic-locale-fallthrough",
  strapi: baseRoute("strapi", { locale: "es" }),
  admin: baseRoute("admin", { locale: "en" }),
} as const

export const PER_CLASS_FIXTURES = [
  STRUCTURAL_MISSING_FIELD,
  VALUE_TITLE_MISMATCH,
  ORDER_BLOCKS_REORDERED,
  SEMANTIC_LOCALE_FALLTHROUGH,
] as const
