import { describe, expect, it } from "vitest"

import { coerceDraftEnvelope } from "./coerce-draft"
import { DraftExperienceSchema } from "./experience-ai.schemas"

/**
 * Unit tests for the deterministic, pure, LOSSY pre-validation coercion
 * helper. Every test asserts BOTH the reshaped object AND the
 * `coercions` accounting (the lossy log of what changed).
 */

// A minimal valid two-block draft used as a clean baseline.
function validDraft() {
  return {
    title: "Hope in difficult seasons",
    metaDescription: "A short reflection on hope.",
    blocks: [
      {
        t: "text",
        heading: "Hope is anchored",
        contentParagraphs: ["Scripture grounds hope in unchanging truth."],
      },
      {
        t: "cta",
        buttonLabel: "Watch now",
      },
    ],
  }
}

describe("coerceDraftEnvelope", () => {
  it("is idempotent on already-valid input (no coercions, validates)", () => {
    const input = validDraft()
    const { draft, coercions } = coerceDraftEnvelope(input)

    expect(coercions).toEqual([])
    // Deep-equal: nothing reshaped.
    expect(draft).toEqual(input)
    // And it still passes the real schema.
    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })

  it("normalizes a case-mismatched discriminator (Section -> section)", () => {
    const input = {
      title: "Layered page",
      metaDescription: "meta",
      blocks: [
        {
          t: "Section",
          content: [{ t: "TEXT", heading: "Inner" }],
        },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    const kinds = coercions.map((c) => c.kind)
    expect(kinds).toContain("discriminator_normalized")
    // Both the outer Section and the inner TEXT get normalized.
    expect(
      coercions.filter((c) => c.kind === "discriminator_normalized").length,
    ).toBe(2)

    const blocks = (draft as { blocks: Array<{ t: string }> }).blocks
    expect(blocks[0].t).toBe("section")
    const inner = (
      draft as { blocks: Array<{ content: Array<{ t: string }> }> }
    ).blocks[0].content
    expect(inner[0].t).toBe("text")

    // The coerced shape passes DraftExperienceSchema.
    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })

  it("strips an unknown top-level-key on a block while preserving the block", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        {
          t: "text",
          heading: "Known",
          contentParagraphs: ["p"],
          // `storageKey` is NOT in DraftTextBlockSchema — .strict() rejects it.
          storageKey: "abc/123.json",
        },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    const stripped = coercions.filter((c) => c.kind === "unknown_key_stripped")
    expect(stripped.length).toBe(1)
    expect(stripped[0].detail).toContain("storageKey")

    const block = (draft as { blocks: Array<Record<string, unknown>> })
      .blocks[0]
    expect(block).not.toHaveProperty("storageKey")
    // Known fields survive.
    expect(block.heading).toBe("Known")
    expect(block.t).toBe("text")

    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })

  it("drops a block with an unknown `t` and records it; others intact", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        { t: "totallyMadeUp", heading: "nope" },
        { t: "text", heading: "Real", contentParagraphs: ["p"] },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    const dropped = coercions.filter((c) => c.kind === "unknown_block_dropped")
    expect(dropped.length).toBe(1)
    expect(dropped[0].detail).toContain("totallyMadeUp")

    const blocks = (draft as { blocks: Array<{ t: string }> }).blocks
    expect(blocks.map((b) => b.t)).toEqual(["text", "cta"])
    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })

  it("drops a mis-scoped block (section inside a container slot) and records it", () => {
    // `section` is a real top-level/section-content type but is NOT
    // allowed in the container-content scope.
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        {
          t: "container",
          slots: [
            {
              content: [
                { t: "section", content: [] }, // illegal here
                { t: "text", heading: "ok", contentParagraphs: ["p"] }, // legal
              ],
            },
          ],
        },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    const misscoped = coercions.filter(
      (c) => c.kind === "misscoped_block_dropped",
    )
    expect(misscoped.length).toBe(1)
    expect(misscoped[0].detail).toContain("section")
    expect(misscoped[0].detail).toContain("container scope")

    const slotContent = (
      draft as {
        blocks: Array<{ slots?: Array<{ content: Array<{ t: string }> }> }>
      }
    ).blocks[0].slots?.[0].content
    expect(slotContent?.map((b) => b.t)).toEqual(["text"])
  })

  it("drops a non-object block entry and records it", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        "not-a-block",
        { t: "text", heading: "Real", contentParagraphs: ["p"] },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    expect(
      coercions.filter((c) => c.kind === "non_object_block_dropped").length,
    ).toBe(1)
    const blocks = (draft as { blocks: Array<{ t: string }> }).blocks
    expect(blocks.map((b) => b.t)).toEqual(["text", "cta"])
  })

  it("fills the videoHero clip window default when both bounds are absent", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        { t: "videoHero", candidateRef: "v01" },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    const filled = coercions.filter((c) => c.kind === "default_filled")
    expect(filled.length).toBe(1)
    expect(filled[0].detail).toContain("clipStartSeconds=0")
    expect(filled[0].detail).toContain("clipEndSeconds=8")

    const hero = (
      draft as {
        blocks: Array<{ clipStartSeconds?: number; clipEndSeconds?: number }>
      }
    ).blocks[0]
    expect(hero.clipStartSeconds).toBe(0)
    expect(hero.clipEndSeconds).toBe(8)
    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })

  it("does NOT override a partial videoHero clip window (intent-preserving)", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        { t: "videoHero", candidateRef: "v01", clipStartSeconds: 12 },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    // No default fill — one bound is editor-meaningful.
    expect(coercions.filter((c) => c.kind === "default_filled")).toEqual([])
    const hero = (
      draft as {
        blocks: Array<{ clipStartSeconds?: number; clipEndSeconds?: number }>
      }
    ).blocks[0]
    expect(hero.clipStartSeconds).toBe(12)
    expect(hero.clipEndSeconds).toBeUndefined()
  })

  it("fills balanced container slot spans by slot count", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        {
          t: "container",
          slots: [
            {
              content: [{ t: "text", heading: "a", contentParagraphs: ["p"] }],
            },
            {
              content: [{ t: "text", heading: "b", contentParagraphs: ["p"] }],
            },
          ],
        },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)

    const filled = coercions.filter((c) => c.kind === "default_filled")
    // 2 slots → md:6 each.
    expect(filled.length).toBe(2)
    const slots = (
      draft as { blocks: Array<{ slots?: Array<{ spans?: { md: number } }> }> }
    ).blocks[0].slots
    expect(slots?.[0].spans).toEqual({ md: 6 })
    expect(slots?.[1].spans).toEqual({ md: 6 })
    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })

  it("returns non-object input unchanged with no coercions", () => {
    expect(coerceDraftEnvelope(null)).toEqual({ draft: null, coercions: [] })
    expect(coerceDraftEnvelope("nope")).toEqual({
      draft: "nope",
      coercions: [],
    })
    expect(coerceDraftEnvelope(42)).toEqual({ draft: 42, coercions: [] })
  })

  it("leaves title/metaDescription untouched, only reshapes blocks", () => {
    const input = {
      title: "Keep me",
      metaDescription: "Keep me too",
      extraTopLevel: "passed-through-untouched",
      blocks: [
        { t: "text", heading: "h", contentParagraphs: ["p"] },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft } = coerceDraftEnvelope(input)
    const obj = draft as Record<string, unknown>
    expect(obj.title).toBe("Keep me")
    expect(obj.metaDescription).toBe("Keep me too")
    // NOTE: coercion only touches `blocks`. Stray top-level keys are
    // intentionally left for DraftExperienceSchema's `.strict()` to
    // reject — coercion is conservative and does not invent top-level
    // policy beyond block reshaping.
    expect(obj.extraTopLevel).toBe("passed-through-untouched")
  })

  it("trims whitespace around an otherwise-canonical discriminator", () => {
    const input = {
      title: "t",
      metaDescription: "m",
      blocks: [
        { t: "  text  ", heading: "h", contentParagraphs: ["p"] },
        { t: "cta", buttonLabel: "Go" },
      ],
    }

    const { draft, coercions } = coerceDraftEnvelope(input)
    expect(
      coercions.filter((c) => c.kind === "discriminator_normalized").length,
    ).toBe(1)
    const blocks = (draft as { blocks: Array<{ t: string }> }).blocks
    expect(blocks[0].t).toBe("text")
    expect(DraftExperienceSchema.safeParse(draft).success).toBe(true)
  })
})
