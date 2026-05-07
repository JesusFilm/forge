import { describe, expect, it } from "vitest"

import { STRAPI_TO_ADMIN_KIND } from "./discriminator-map"
import {
  StrapiNormalizationError,
  normalizeStrapi,
  type StrapiBlockInput,
  type StrapiExperienceInput,
} from "./normalize-strapi"

const OPTIONS = {
  urlLocale: "en",
  baseOrigin: "https://cdn.example.com",
} as const

function baseInput(
  overrides: Partial<StrapiExperienceInput> = {},
): StrapiExperienceInput {
  return {
    documentId: "doc-1",
    slug: "test-slug",
    locale: "en",
    title: "Test Experience",
    metaDescription: "test description",
    ogImage: null,
    blocks: [],
    ...overrides,
  }
}

describe("normalizeStrapi — happy paths", () => {
  it("returns a NormalizedExperienceRoute with required fields populated", () => {
    const result = normalizeStrapi(baseInput(), OPTIONS)
    expect(result.id).toBe("doc-1")
    expect(result.slug).toBe("test-slug")
    expect(result.locale).toBe("en")
    expect(result.title).toBe("Test Experience")
    expect(result.description).toBe("test description")
    expect(result.blocks).toEqual([])
    expect(result.meta.source).toBe("strapi")
  })

  it("locale field surfaces verbatim on normalized.locale", () => {
    const result = normalizeStrapi(baseInput({ locale: "es" }), OPTIONS)
    expect(result.locale).toBe("es")
  })
})

describe("normalizeStrapi — error paths", () => {
  it("throws StrapiNormalizationError naming missing 'slug'", () => {
    const input = baseInput({ slug: "" })
    expect(() => normalizeStrapi(input, OPTIONS)).toThrow(
      StrapiNormalizationError,
    )
    try {
      normalizeStrapi(input, OPTIONS)
    } catch (e) {
      expect((e as StrapiNormalizationError).missingField).toBe("slug")
    }
  })

  it("throws StrapiNormalizationError naming missing 'documentId'", () => {
    const input = baseInput({ documentId: "" })
    expect(() => normalizeStrapi(input, OPTIONS)).toThrow(
      /required field 'documentId'/,
    )
  })

  it("throws StrapiNormalizationError when 'title' is not a string", () => {
    const input = baseInput({ title: undefined as unknown as string })
    expect(() => normalizeStrapi(input, OPTIONS)).toThrow(
      /required field 'title'/,
    )
  })
})

describe("normalizeStrapi — absent-field contract", () => {
  it("normalizes description: null to null", () => {
    const result = normalizeStrapi(
      baseInput({ metaDescription: null }),
      OPTIONS,
    )
    expect(result.description).toBeNull()
  })

  it("normalizes description: undefined to null", () => {
    const result = normalizeStrapi(
      baseInput({ metaDescription: undefined }),
      OPTIONS,
    )
    expect(result.description).toBeNull()
  })

  it("normalizes missing 'metaDescription' key to null", () => {
    const input = baseInput()
    const cloned = { ...input }
    delete (cloned as Record<string, unknown>).metaDescription
    const result = normalizeStrapi(cloned as StrapiExperienceInput, OPTIONS)
    expect(result.description).toBeNull()
  })

  it("normalizes null ogImage to null on output", () => {
    const result = normalizeStrapi(baseInput({ ogImage: null }), OPTIONS)
    expect(result.ogImage).toBeNull()
  })

  it("normalizes undefined ogImage to null on output", () => {
    const result = normalizeStrapi(baseInput({ ogImage: undefined }), OPTIONS)
    expect(result.ogImage).toBeNull()
  })

  it("normalizes missing 'blocks' key to empty array", () => {
    const input = baseInput()
    const cloned = { ...input }
    delete (cloned as Record<string, unknown>).blocks
    const result = normalizeStrapi(cloned as StrapiExperienceInput, OPTIONS)
    expect(result.blocks).toEqual([])
  })
})

describe("normalizeStrapi — URL canonicalization", () => {
  it("expands a Strapi root-relative ogImage url against baseOrigin", () => {
    const result = normalizeStrapi(
      baseInput({
        ogImage: {
          url: "/images/foo.jpg",
          width: 1200,
          height: 630,
          alternativeText: "alt",
        },
      }),
      OPTIONS,
    )
    expect(result.ogImage?.url).toBe("https://cdn.example.com/images/foo.jpg")
    expect(result.meta.rawUrls).toEqual({
      "https://cdn.example.com/images/foo.jpg": "/images/foo.jpg",
    })
  })

  it("preserves raw input alongside canonical in meta.rawUrls", () => {
    const result = normalizeStrapi(
      baseInput({
        ogImage: {
          url: "/images/x.png",
          width: null,
          height: null,
          alternativeText: null,
        },
      }),
      OPTIONS,
    )
    expect(Object.values(result.meta.rawUrls)).toContain("/images/x.png")
  })
})

describe("normalizeStrapi — block discriminator translation", () => {
  it("maps ComponentSectionsMediaCollection to kind: 'mediaCollection'", () => {
    const block: StrapiBlockInput = {
      __typename: "ComponentSectionsMediaCollection",
      id: "block-1",
      heading: "test",
    }
    const result = normalizeStrapi(baseInput({ blocks: [block] }), OPTIONS)
    expect(result.blocks[0]?.kind).toBe("mediaCollection")
    expect(result.blocks[0]?.id).toBe("block-1")
  })

  it("covers all 16 shared block discriminators (per-discriminator coverage)", () => {
    const allTypenames = Object.keys(STRAPI_TO_ADMIN_KIND)
    const blocks: StrapiBlockInput[] = allTypenames.map(
      (typename, idx) =>
        ({
          __typename: typename,
          id: `block-${idx}`,
        }) as StrapiBlockInput,
    )
    const result = normalizeStrapi(baseInput({ blocks }), OPTIONS)
    expect(result.blocks).toHaveLength(16)
    for (let i = 0; i < allTypenames.length; i++) {
      const typename = allTypenames[i]!
      const expectedKind =
        STRAPI_TO_ADMIN_KIND[typename as keyof typeof STRAPI_TO_ADMIN_KIND]
      // Container is flattened (single block emitted), Section is at top-level.
      // Both surface as their expected kind in the normalized array.
      const block = result.blocks[i]
      expect(block?.kind, `index ${i} (${typename})`).toBe(expectedKind)
    }
  })
})

describe("normalizeStrapi — container flatten", () => {
  it("flattens a container with two slots into a flat content array with synthetic markers", () => {
    const container: StrapiBlockInput = {
      __typename: "ComponentSectionsContainer",
      id: "ctr-1",
      slots: [
        {
          id: "slot-1",
          gridSpan: 2,
          spans: [1, 2],
          content: [
            { __typename: "ComponentSectionsText", id: "txt-1" },
            { __typename: "ComponentSectionsCta", id: "cta-1" },
          ],
        },
        {
          id: "slot-2",
          gridSpan: 1,
          spans: null,
          content: [
            { __typename: "ComponentSectionsVideo", id: "vid-1" },
            { __typename: "ComponentSectionsCard", id: "card-1" },
          ],
        },
      ],
    }
    const result = normalizeStrapi(baseInput({ blocks: [container] }), OPTIONS)

    expect(result.blocks).toHaveLength(1)
    const top = result.blocks[0]
    expect(top?.kind).toBe("container")
    if (!top || top.kind !== "container") throw new Error("expected container")
    const flat = top.data.content as ReadonlyArray<{
      kind: string
      id: string
      gridSpan?: number | null
    }>
    expect(flat).toHaveLength(6)
    expect(flat[0]).toMatchObject({
      kind: "containerSlot",
      id: "slot-1",
      gridSpan: 2,
    })
    expect(flat[1]).toMatchObject({ kind: "text", id: "txt-1" })
    expect(flat[2]).toMatchObject({ kind: "cta", id: "cta-1" })
    expect(flat[3]).toMatchObject({
      kind: "containerSlot",
      id: "slot-2",
      gridSpan: 1,
    })
    expect(flat[4]).toMatchObject({ kind: "video", id: "vid-1" })
    expect(flat[5]).toMatchObject({ kind: "card", id: "card-1" })
  })

  it("emits empty container content when slots is null", () => {
    const container: StrapiBlockInput = {
      __typename: "ComponentSectionsContainer",
      id: "ctr-1",
      slots: null,
    }
    const result = normalizeStrapi(baseInput({ blocks: [container] }), OPTIONS)
    const top = result.blocks[0]
    if (!top || top.kind !== "container") throw new Error("expected container")
    expect(top.data.content).toEqual([])
  })
})

describe("normalizeStrapi — truncation detection", () => {
  it("sets potentiallyTruncated: false in fixture mode (no response meta)", () => {
    const result = normalizeStrapi(baseInput({ blocks: [] }), OPTIONS)
    expect(result.meta.potentiallyTruncated).toBe(false)
  })

  it("sets potentiallyTruncated: false when length is exactly 10 but no meta says truncated", () => {
    // Length-based heuristics are NOT a trigger — per plan Key Decisions.
    const blocks: StrapiBlockInput[] = Array.from({ length: 10 }, (_, i) => ({
      __typename: "ComponentSectionsText",
      id: `t-${i}`,
    }))
    const result = normalizeStrapi(baseInput({ blocks }), OPTIONS)
    expect(result.meta.potentiallyTruncated).toBe(false)
  })

  it("sets potentiallyTruncated: true when response meta says total > returned", () => {
    const result = normalizeStrapi(
      baseInput({
        blocks: [],
        _meta: { pagination: { total: 12, returned: 10 } },
      }),
      OPTIONS,
    )
    expect(result.meta.potentiallyTruncated).toBe(true)
  })

  it("sets potentiallyTruncated: false when total == returned", () => {
    const result = normalizeStrapi(
      baseInput({
        blocks: [],
        _meta: { pagination: { total: 5, returned: 5 } },
      }),
      OPTIONS,
    )
    expect(result.meta.potentiallyTruncated).toBe(false)
  })
})
