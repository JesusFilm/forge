/**
 * Captured-from-live canary fixture — PLACEHOLDER.
 *
 * Real Strapi + admin response captures land here once the canary
 * route is selected (U5). The placeholder exports the expected file
 * shape so adding the real data is a single-file change.
 *
 * Per the U6 plan: "Real captured data lands when canary route is
 * selected (deferred decision in Open Questions); the placeholder
 * structure makes the addition a single-file change."
 *
 * Capture procedure:
 *   1. Set FORGE_PARITY_LIVE=1, FORGE_STRAPI_URL, FORGE_ADMIN_URL,
 *      FORGE_STRAPI_PUBLIC_ORIGIN locally.
 *   2. Run:
 *        pnpm tsx packages/graphql/scripts/capture-parity-fixture.ts \
 *          --slug <canary-slug> --locale <locale> \
 *          --out packages/graphql/src/parity/__fixtures__/captured/canary-experience.json
 *   3. Inspect the JSON for sensitive fields before committing.
 *   4. Update this file to import from the JSON.
 */

import type { NormalizedExperienceRoute } from "../../shared-shape"

export type CapturedFixture = {
  readonly name: string
  readonly slug: string
  readonly locale: string
  readonly capturedAt: string | null
  readonly strapi: NormalizedExperienceRoute | null
  readonly admin: NormalizedExperienceRoute | null
}

export const CANARY_EXPERIENCE: CapturedFixture = {
  name: "canary-experience-placeholder",
  slug: "PLACEHOLDER_SLUG",
  locale: "en",
  capturedAt: null,
  strapi: null,
  admin: null,
}

export const CAPTURED_FIXTURES: ReadonlyArray<CapturedFixture> = [
  CANARY_EXPERIENCE,
]
