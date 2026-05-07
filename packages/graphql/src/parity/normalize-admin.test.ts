import { BlocksSchema } from "@forge/admin/domain/blocks"
import { describe, expect, it } from "vitest"

import { ADMIN_ONLY_KINDS, STRAPI_TO_ADMIN_KIND } from "./discriminator-map"
import {
  AdminBlocksValidationError,
  AdminNormalizationError,
  normalizeAdmin,
  type AdminExperienceLocaleInput,
} from "./normalize-admin"

const OPTIONS = {
  urlLocale: "en",
  baseOrigin: "https://cdn.example.com",
} as const

function baseInput(
  overrides: Partial<AdminExperienceLocaleInput> = {},
): AdminExperienceLocaleInput {
  return {
    id: "exp-loc-1",
    slug: "test-slug",
    locale: "en",
    title: "Test Experience",
    description: "test description",
    ogImageUrl: null,
    blocks: [],
    ...overrides,
  }
}

// Minimal valid admin block fixtures — one per shared kind. The shape
// mirrors what BlocksSchema accepts at write time (`.strict()` rejects
// unknown keys; admin blocks have NO per-block `id` field — they're
// JSON nodes inside ExperienceLocale.blocks, not table rows).

function adminMediaCollection() {
  return {
    t: "mediaCollection",
    sectionKey: "key-1",
    variant: "carousel" as const,
  }
}

function adminText() {
  return {
    t: "text",
    sectionKey: "key-2",
  }
}

describe("normalizeAdmin — happy paths", () => {
  it("returns a NormalizedExperienceRoute with required fields populated", () => {
    const result = normalizeAdmin(baseInput(), OPTIONS)
    expect(result.id).toBe("exp-loc-1")
    expect(result.slug).toBe("test-slug")
    expect(result.locale).toBe("en")
    expect(result.title).toBe("Test Experience")
    expect(result.description).toBe("test description")
    expect(result.blocks).toEqual([])
    expect(result.meta.source).toBe("admin")
    expect(result.meta.potentiallyTruncated).toBe(false)
  })

  it("locale field surfaces verbatim on normalized.locale (resolved-locale equality)", () => {
    const result = normalizeAdmin(baseInput({ locale: "es" }), OPTIONS)
    expect(result.locale).toBe("es")
  })
})

describe("normalizeAdmin — error paths", () => {
  it("throws AdminNormalizationError naming missing 'id'", () => {
    expect(() => normalizeAdmin(baseInput({ id: "" }), OPTIONS)).toThrow(
      AdminNormalizationError,
    )
  })

  it("throws AdminNormalizationError naming missing 'slug'", () => {
    try {
      normalizeAdmin(baseInput({ slug: "" }), OPTIONS)
    } catch (e) {
      expect((e as AdminNormalizationError).missingField).toBe("slug")
      return
    }
    throw new Error("expected normalizeAdmin to throw")
  })

  it("throws AdminBlocksValidationError on a block with an unknown 't' discriminator", () => {
    const input = baseInput({
      blocks: [{ t: "totallyNew" }],
    })
    expect(() => normalizeAdmin(input, OPTIONS)).toThrow(
      AdminBlocksValidationError,
    )
  })

  it("AdminBlocksValidationError carries Zod issue path information", () => {
    // strict() rejects unknown 'extraField' on a valid kind;
    // path on the issue points to the failing block index + key.
    const input = baseInput({
      blocks: [{ t: "text", extraField: "not-allowed" }],
    })
    try {
      normalizeAdmin(input, OPTIONS)
    } catch (e) {
      expect(e).toBeInstanceOf(AdminBlocksValidationError)
      const err = e as AdminBlocksValidationError
      expect(err.issues.length).toBeGreaterThan(0)
      expect(err.issues.some((i) => i.path.includes(0))).toBe(true)
      return
    }
    throw new Error("expected validation error")
  })
})

describe("normalizeAdmin — absent-field contract", () => {
  it("normalizes description: null to null", () => {
    const result = normalizeAdmin(baseInput({ description: null }), OPTIONS)
    expect(result.description).toBeNull()
  })

  it("normalizes description: undefined to null", () => {
    const result = normalizeAdmin(
      baseInput({ description: undefined }),
      OPTIONS,
    )
    expect(result.description).toBeNull()
  })

  it("normalizes missing 'description' key to null", () => {
    const input = baseInput()
    const cloned = { ...input }
    delete (cloned as Record<string, unknown>).description
    const result = normalizeAdmin(cloned as AdminExperienceLocaleInput, OPTIONS)
    expect(result.description).toBeNull()
  })

  it("normalizes null ogImageUrl to null on output", () => {
    const result = normalizeAdmin(baseInput({ ogImageUrl: null }), OPTIONS)
    expect(result.ogImage).toBeNull()
  })

  it("ogImage shape on present ogImageUrl: width/height/alt are null (admin lossy superset)", () => {
    const result = normalizeAdmin(
      baseInput({ ogImageUrl: "https://cdn.example.com/og.jpg" }),
      OPTIONS,
    )
    expect(result.ogImage).toEqual({
      url: "https://cdn.example.com/og.jpg",
      width: null,
      height: null,
      alt: null,
    })
  })
})

describe("normalizeAdmin — URL canonicalization", () => {
  it("canonicalizes ogImageUrl (trailing slash strip, host lowercase)", () => {
    const result = normalizeAdmin(
      baseInput({ ogImageUrl: "https://CDN.example.com/og.jpg/" }),
      OPTIONS,
    )
    expect(result.ogImage?.url).toBe("https://cdn.example.com/og.jpg")
    expect(Object.values(result.meta.rawUrls)).toContain(
      "https://CDN.example.com/og.jpg/",
    )
  })
})

describe("normalizeAdmin — block discriminator coverage", () => {
  it("maps admin t: 'mediaCollection' to kind: 'mediaCollection'", () => {
    const result = normalizeAdmin(
      baseInput({ blocks: [adminMediaCollection()] }),
      OPTIONS,
    )
    expect(result.blocks[0]?.kind).toBe("mediaCollection")
    // Admin blocks have no per-block id — normalizer emits empty string.
    expect(result.blocks[0]?.id).toBe("")
  })

  it("maps admin t: 'text' to kind: 'text'", () => {
    const result = normalizeAdmin(baseInput({ blocks: [adminText()] }), OPTIONS)
    expect(result.blocks[0]?.kind).toBe("text")
  })

  it("accepts admin-only 'videoRecommendations' kind via BlocksSchema", () => {
    const result = normalizeAdmin(
      baseInput({
        blocks: [
          {
            t: "videoRecommendations",
            sectionKey: "key-vr",
            limit: 6,
          },
        ],
      }),
      OPTIONS,
    )
    expect(result.blocks[0]?.kind).toBe("videoRecommendations")
  })
})

describe("BlocksSchema cross-package totality (deferred-from-U2)", () => {
  it("every shared admin kind in STRAPI_TO_ADMIN_KIND is reachable via BlocksSchema's discriminator union", () => {
    // Surface for the cross-package check: BlocksSchema is a
    // discriminated union over `t`. Walk its `_zod.def.options` to
    // collect the discriminators each branch accepts. Zod 4 exposes
    // `_zod.def.options` for discriminated unions.
    const sharedKinds = new Set<string>(Object.values(STRAPI_TO_ADMIN_KIND))
    const adminOnly = new Set<string>(ADMIN_ONLY_KINDS)
    const def = BlocksSchema._zod.def
    expect(def.type).toBe("array")
    if (def.type !== "array") throw new Error("expected array root")
    const elementDef = def.element._zod.def
    expect(elementDef.type).toBe("union")
    if (elementDef.type !== "union") throw new Error("expected union element")
    // Collect each option's `t` literal.
    const branchKinds = new Set<string>()
    for (const option of elementDef.options) {
      const optionDef = option._zod.def
      if (optionDef.type !== "object") continue
      const tField = optionDef.shape.t
      if (!tField) continue
      const tDef = tField._zod.def
      if (tDef.type === "literal" && tDef.values.length === 1) {
        const value = tDef.values[0]
        if (typeof value === "string") branchKinds.add(value)
      }
    }
    // Every shared kind must be reachable.
    for (const sharedKind of sharedKinds) {
      expect(
        branchKinds.has(sharedKind),
        `BlocksSchema covers ${sharedKind}`,
      ).toBe(true)
    }
    // Every admin-only kind must be reachable too.
    for (const adminOnlyKind of adminOnly) {
      expect(
        branchKinds.has(adminOnlyKind),
        `BlocksSchema covers ${adminOnlyKind}`,
      ).toBe(true)
    }
    // Surface any new admin kind we don't classify.
    const unclassified = [...branchKinds].filter(
      (k) => !sharedKinds.has(k) && !adminOnly.has(k),
    )
    expect(
      unclassified,
      `if this fails, classify the new admin kinds in discriminator-map.ts`,
    ).toEqual([])
  })
})
