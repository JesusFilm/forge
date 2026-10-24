/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({
  env: { REVALIDATION_SECRET: "test-revalidation-secret" },
}))

import {
  createDynamicCollectionFeedCacheSignature,
  createInitialDynamicCollectionFeedCacheSignatures,
  isDynamicCollectionFeedCacheSignatureValid,
} from "./dynamic-collection-cache-signature"

const input = {
  locale: "en",
  languageSlug: "english",
  cacheScope: "live" as const,
  after: null,
  excludedIds: ["featured-id"],
  excludedSlugs: ["featured-slug"],
  first: 3 as const,
  cardsPerParent: 12 as const,
}

describe("dynamic collection feed cache signatures", () => {
  it("creates deterministic signatures bound to every shared-cache variant", () => {
    const signature = createDynamicCollectionFeedCacheSignature(input)

    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createDynamicCollectionFeedCacheSignature(input)).toBe(signature)
    expect(isDynamicCollectionFeedCacheSignatureValid(input, signature)).toBe(
      true,
    )

    for (const changed of [
      { ...input, locale: "fr" },
      { ...input, languageSlug: "french" },
      { ...input, cacheScope: "preview" as const },
      { ...input, after: "cursor-1" },
      { ...input, excludedIds: ["other"] },
      { ...input, excludedSlugs: ["other"] },
      { ...input, first: 2 as const, cardsPerParent: 8 as const },
    ]) {
      expect(
        isDynamicCollectionFeedCacheSignatureValid(changed, signature),
      ).toBe(false)
    }
    expect(isDynamicCollectionFeedCacheSignatureValid(input, "short")).toBe(
      false,
    )
  })

  it("creates both canonical initial profile signatures on the server", () => {
    const signatures = createInitialDynamicCollectionFeedCacheSignatures({
      locale: input.locale,
      languageSlug: input.languageSlug,
      cacheScope: input.cacheScope,
      excludedIds: input.excludedIds,
      excludedSlugs: input.excludedSlugs,
    })

    expect(signatures.mobile).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(signatures.desktop).toBe(
      createDynamicCollectionFeedCacheSignature(input),
    )
    expect(signatures.mobile).not.toBe(signatures.desktop)
  })
})
