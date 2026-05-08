/**
 * Bidirectional table mapping Strapi block component `__typename` values
 * to admin block schema `t` literal values, plus a separate enumeration
 * of admin-only kinds.
 *
 * The 16 entries below are the 1:1 mapping over the Strapi
 * `ExperienceBlocksDynamicZone` union (excluding the synthesized
 * `Error` type). Admin's `BlocksSchema` has 17 top-level kinds — the 16
 * shared, plus admin-only `videoRecommendations` (forward-looking; no
 * Strapi precedent). Synthetic `containerSlot` markers are emitted by
 * the Strapi normalizer when flattening `container.slots[].content[]`
 * to admin's flat `container.content[]` shape — they live in admin's
 * `ContainerContentBlockSchema` scope and are NOT top-level discriminators.
 *
 * Totality is asserted at test time by importing `BlocksSchema` from
 * `@forge/admin/domain/blocks` and verifying every shared kind has a map
 * entry — surfacing new admin kinds as test failures rather than silent
 * unknown-sentinel passes.
 */

/**
 * Strapi `__typename` → admin `kind` mapping. Sorted alphabetically by
 * Strapi typename to make additions reviewable.
 */
export const STRAPI_TO_ADMIN_KIND = {
  ComponentSectionsAdventCountdown: "adventCountdown",
  ComponentSectionsBibleQuotesCarousel: "bibleQuotesCarousel",
  ComponentSectionsCard: "card",
  ComponentSectionsContainer: "container",
  ComponentSectionsCta: "cta",
  ComponentSectionsEasterDates: "easterDates",
  ComponentSectionsInfoBlocks: "infoBlocks",
  ComponentSectionsMediaCollection: "mediaCollection",
  ComponentSectionsNavigationCarousel: "navigationCarousel",
  ComponentSectionsPromoBanner: "promoBanner",
  ComponentSectionsRelatedQuestions: "relatedQuestions",
  ComponentSectionsSection: "section",
  ComponentSectionsText: "text",
  ComponentSectionsVideo: "video",
  ComponentSectionsVideoCarousel: "videoCarousel",
  ComponentSectionsVideoHero: "videoHero",
} as const satisfies Readonly<Record<string, string>>

/**
 * Admin kinds that have NO Strapi counterpart. Captured-from-live fixtures
 * for these kinds are admin-only; per-discriminator parity coverage in U6
 * skips Strapi-side fixtures for these.
 */
export const ADMIN_ONLY_KINDS = ["videoRecommendations"] as const

/**
 * Reverse table — admin `kind` → Strapi `__typename`. Built once at module
 * load and frozen.
 */
export const ADMIN_KIND_TO_STRAPI: Readonly<Record<string, StrapiTypename>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(STRAPI_TO_ADMIN_KIND).map(([k, v]) => [v, k]),
    ) as Record<string, StrapiTypename>,
  )

export type StrapiTypename = keyof typeof STRAPI_TO_ADMIN_KIND
export type AdminKind = (typeof STRAPI_TO_ADMIN_KIND)[StrapiTypename]
export type AdminOnlyKind = (typeof ADMIN_ONLY_KINDS)[number]

/**
 * Sentinel returned when a Strapi `__typename` is not in the map.
 * The Strapi normalizer surfaces this on the normalized output so the
 * differ can flag it as a structural mismatch rather than the call
 * site throwing — a parity harness should never hide unknown kinds.
 */
export type UnknownDiscriminator = {
  readonly kind: "unknown"
  readonly raw: string
}

/**
 * Look up the admin `kind` for a Strapi `__typename`. Returns the
 * unknown-sentinel for any value not in the map. Callers must check
 * for `kind === "unknown"` before treating the result as an `AdminKind`.
 */
export function strapiTypenameToAdminKind(
  typename: string,
): AdminKind | UnknownDiscriminator {
  if (Object.prototype.hasOwnProperty.call(STRAPI_TO_ADMIN_KIND, typename)) {
    return STRAPI_TO_ADMIN_KIND[typename as StrapiTypename]
  }
  return { kind: "unknown", raw: typename }
}

/**
 * Look up the Strapi `__typename` for an admin `kind`. Returns
 * `undefined` for admin-only kinds (e.g., `videoRecommendations`).
 * Callers MUST handle `undefined` — passing it to a Strapi query
 * silently produces a malformed selection set.
 */
export function adminKindToStrapiTypename(
  kind: string,
): StrapiTypename | undefined {
  return ADMIN_KIND_TO_STRAPI[kind]
}
