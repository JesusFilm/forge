/**
 * Shared-contract parity test (R3).
 *
 * This test imports ONLY the package's public surface (`./index`) and pulls
 * in nothing from `apps/admin`. Because `@forge/experience-schema` declares
 * no admin dependency, a green run here proves the generation contract
 * (schemas + JSON extraction + coercion) is consumable standalone by
 * `apps/mastra` exactly as admin consumes it — so the generator and admin's
 * re-validator cannot drift.
 *
 * Deep behavioural coverage lives in the co-located module tests
 * (`extract-json-object.test.ts`, `coerce-draft.test.ts`,
 * `experience-ai-skeleton.schemas.test.ts`); this file guards the package
 * boundary and the public export surface.
 */
import { describe, expect, it } from "vitest"

import {
  DraftExperienceSchema,
  DraftVideoSectionSchema,
  DraftBibleQuoteItemSchema,
  SkeletonSchema,
  validateSkeleton,
  getFillSchemaForType,
  FILL_SCHEMAS_BY_TYPE,
  GENERATION_MIN_BLOCKS,
  buildDraftExperienceJsonSchema,
  extractJsonObject,
  coerceDraftEnvelope,
} from "./index"

describe("@forge/experience-schema public surface (admin-free contract)", () => {
  it("exposes the generation-contract symbols as their expected kinds", () => {
    expect(typeof DraftExperienceSchema.safeParse).toBe("function")
    expect(typeof DraftVideoSectionSchema.safeParse).toBe("function")
    expect(typeof DraftBibleQuoteItemSchema.safeParse).toBe("function")
    expect(typeof SkeletonSchema.safeParse).toBe("function")
    expect(typeof validateSkeleton).toBe("function")
    expect(typeof getFillSchemaForType).toBe("function")
    expect(typeof coerceDraftEnvelope).toBe("function")
    expect(typeof extractJsonObject).toBe("function")
    expect(typeof buildDraftExperienceJsonSchema).toBe("function")
  })

  it("keeps the reference-first scripture contract on the public surface (no LLM verse text)", () => {
    // The model emits a reference + structured citation identity; verse text is resolved
    // at web render, never authored by the LLM. The package surface must accept a
    // text-less, structured quote so the generator and admin re-validation agree.
    const referenceOnly = DraftBibleQuoteItemSchema.safeParse({
      reference: "John 20:19-29",
      osisId: "John.20.19",
      chapterStart: 20,
      verseStart: 19,
      verseEnd: 29,
    })
    expect(referenceOnly.success).toBe(true)

    // A minimal grounded section (video hero + FAQ + reference-first scripture) validates.
    const section = DraftVideoSectionSchema.safeParse({
      blocks: [
        { t: "videoHero", candidateRef: "v01", heading: "The Resurrection" },
        {
          t: "relatedQuestions",
          questions: [
            { question: "Why does the resurrection matter?", answer: "..." },
          ],
        },
        {
          t: "bibleQuotesCarousel",
          quotes: [
            {
              reference: "John 20:19-29",
              osisId: "John.20.19",
              chapterStart: 20,
              verseStart: 19,
              verseEnd: 29,
            },
          ],
        },
      ],
    })
    expect(section.success).toBe(true)
  })

  it("single-sources GENERATION_MIN_BLOCKS as a positive integer", () => {
    expect(Number.isInteger(GENERATION_MIN_BLOCKS)).toBe(true)
    expect(GENERATION_MIN_BLOCKS).toBeGreaterThan(0)
  })

  it("resolves a fill schema for every fillable block type via the package surface", () => {
    const types = Object.keys(FILL_SCHEMAS_BY_TYPE)
    expect(types.length).toBeGreaterThan(0)
    for (const t of types) {
      const schema = getFillSchemaForType(t)
      expect(schema, `expected a fill schema for "${t}"`).toBeDefined()
      expect(typeof schema?.safeParse).toBe("function")
    }
    expect(getFillSchemaForType("definitely-not-a-block-type")).toBeUndefined()
  })

  it("extracts a fenced JSON envelope so the extract → coerce → validate path stays wired", () => {
    const fenced =
      'Here is the draft:\n```json\n{"title":"x"}\n```\nLet me know!'
    expect(extractJsonObject(fenced)).toBe('{"title":"x"}')
  })

  it("coerceDraftEnvelope is total over arbitrary input and returns the documented shape", () => {
    const result = coerceDraftEnvelope({ title: "x", blocks: [] })
    expect(result).toHaveProperty("draft")
    expect(Array.isArray(result.coercions)).toBe(true)
  })

  it("buildDraftExperienceJsonSchema returns a non-null JSON-schema object", () => {
    const jsonSchema = buildDraftExperienceJsonSchema()
    expect(jsonSchema).toBeTypeOf("object")
    expect(jsonSchema).not.toBeNull()
  })
})
