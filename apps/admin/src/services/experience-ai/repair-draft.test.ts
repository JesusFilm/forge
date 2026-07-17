import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { ExperienceAiNormalizationError } from "./experience-ai-normalize"
import {
  DraftExperienceSchema,
  type DraftExperience,
  type VideoCandidate,
} from "@forge/experience-schema"
import {
  classifyRepairability,
  isRepairEligible,
  RepairDraftError,
  repairDraft,
  serializeNormalizationError,
} from "./repair-draft"

/**
 * Assert a rejection is the REAL `RepairDraftError` class with the given
 * reason (not just a same-shaped object) — mocked-shape-vs-real-contract
 * discipline: deleting the typed class must fail this test.
 */
async function expectRepairDraftError(
  promise: Promise<unknown>,
  reason: RepairDraftError["reason"],
): Promise<void> {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(RepairDraftError)
  expect((err as RepairDraftError).reason).toBe(reason)
}

// A minimal, schema-valid DraftExperience. `text` has only optional fields;
// `card` requires title + description — together they satisfy
// DraftExperienceSchema (>= GENERATION_MIN_BLOCKS top-level blocks).
const VALID_DRAFT: DraftExperience = {
  title: "Hope for the journey",
  metaDescription: "A short reflection on hope.",
  blocks: [
    {
      t: "text",
      heading: "Hope is anchored",
      contentParagraphs: ["Anchored."],
    },
    { t: "card", title: "Hope", description: "What scripture says." },
  ],
}

const CANDIDATES: VideoCandidate[] = [
  {
    ref: "v01",
    videoId: "video-1",
    slug: "hope",
    title: "Hope Story",
    description: null,
    previewImageUrl: null,
    previewStreamUrl: null,
    label: null,
  },
]

// Sanity: the fixture really is valid (so a "still-invalid" repair test is
// meaningful — only the deliberately-broken output should fail).
describe("VALID_DRAFT fixture", () => {
  it("satisfies DraftExperienceSchema", () => {
    expect(DraftExperienceSchema.safeParse(VALID_DRAFT).success).toBe(true)
  })
})

describe("classifyRepairability", () => {
  // One fixture PER normalization code where ONLY that branch matches.
  // Throw the REAL ExperienceAiNormalizationError (per the
  // mocked-shape-vs-real-contract discipline) so a deleted branch fails.
  it("INVALID_BLOCKS -> schema_violation (repair-eligible)", () => {
    const err = new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom")
    expect(classifyRepairability(err)).toBe("schema_violation")
    expect(isRepairEligible(classifyRepairability(err))).toBe(true)
  })

  it("BELOW_MIN_BLOCKS -> schema_violation (repair-eligible)", () => {
    const err = new ExperienceAiNormalizationError("BELOW_MIN_BLOCKS", "boom")
    expect(classifyRepairability(err)).toBe("schema_violation")
    expect(isRepairEligible(classifyRepairability(err))).toBe(true)
  })

  it("UNKNOWN_VIDEO_REF -> structurally_impossible (NOT repair-eligible)", () => {
    const err = new ExperienceAiNormalizationError("UNKNOWN_VIDEO_REF", "boom")
    expect(classifyRepairability(err)).toBe("structurally_impossible")
    expect(isRepairEligible(classifyRepairability(err))).toBe(false)
  })

  it("UNKNOWN_SECTION_REF -> structurally_impossible (NOT repair-eligible)", () => {
    const err = new ExperienceAiNormalizationError(
      "UNKNOWN_SECTION_REF",
      "boom",
    )
    expect(classifyRepairability(err)).toBe("structurally_impossible")
    expect(isRepairEligible(classifyRepairability(err))).toBe(false)
  })

  it("DUPLICATE_SECTION_REF -> structurally_impossible (NOT repair-eligible)", () => {
    const err = new ExperienceAiNormalizationError(
      "DUPLICATE_SECTION_REF",
      "boom",
    )
    expect(classifyRepairability(err)).toBe("structurally_impossible")
    expect(isRepairEligible(classifyRepairability(err))).toBe(false)
  })
})

describe("serializeNormalizationError", () => {
  it("produces a non-empty instruction carrying the code and message", () => {
    const err = new ExperienceAiNormalizationError(
      "INVALID_BLOCKS",
      "AI draft did not normalize into a valid admin BlocksSchema payload",
    )
    const out = serializeNormalizationError(err)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain("INVALID_BLOCKS")
    expect(out).toContain("did not normalize")
  })

  it("includes concrete Zod issue paths when the error carries a ZodError cause", () => {
    const zodError = new z.ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["blocks", 0, "title"],
        message: "Required",
      } as z.ZodIssue,
    ])
    const err = new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom")
    ;(err as { cause?: unknown }).cause = zodError
    const out = serializeNormalizationError(err)
    expect(out).toContain("blocks.0.title")
    expect(out).toContain("Required")
  })
})

// Mock getMastra so repairDraft's getAgentById(...).generate(...) hits a spy.
// The REAL parse/lift/coerce/validate path runs on the agent's output so the
// repair branch is load-bearing.
function mockMastra(generate: ReturnType<typeof vi.fn>) {
  return {
    getAgentById: vi.fn().mockReturnValue({ generate }),
  } as unknown as Parameters<typeof repairDraft>[0]["mastra"]
}

describe("repairDraft", () => {
  it("calls the repair agent exactly once and returns the parsed corrected draft", async () => {
    // Agent replies with the experience-reviser's diff envelope shape.
    const generate = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        diff: {
          scalars: {
            title: { before: "old", after: VALID_DRAFT.title },
            metaDescription: {
              before: null,
              after: VALID_DRAFT.metaDescription,
            },
          },
          blocks: VALID_DRAFT.blocks,
        },
      }),
    })
    const mastra = mockMastra(generate)

    const repaired = await repairDraft({
      draft: VALID_DRAFT,
      candidates: CANDIDATES,
      error: new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom"),
      attempt: 1,
      mastra,
      timeoutMs: 30_000,
    })

    expect(generate).toHaveBeenCalledTimes(1)
    // The prompt carries the serialized error + the candidate refs.
    const promptArg = generate.mock.calls[0][0] as string
    expect(promptArg).toContain("INVALID_BLOCKS")
    expect(promptArg).toContain("v01")
    // Returned value is a validated DraftExperience.
    expect(DraftExperienceSchema.safeParse(repaired).success).toBe(true)
    expect(repaired.title).toBe(VALID_DRAFT.title)
    expect(repaired.blocks).toHaveLength(2)
  })

  it("accepts a flat {title, metaDescription, blocks} reply (no envelope)", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify(VALID_DRAFT) })
    const repaired = await repairDraft({
      draft: VALID_DRAFT,
      candidates: CANDIDATES,
      error: new ExperienceAiNormalizationError("BELOW_MIN_BLOCKS", "boom"),
      attempt: 1,
      mastra: mockMastra(generate),
      timeoutMs: 30_000,
    })
    expect(repaired.title).toBe(VALID_DRAFT.title)
  })

  it("throws RepairDraftError(malformed_syntax) when the reply is not JSON", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ text: "I cannot produce that, sorry." })
    await expectRepairDraftError(
      repairDraft({
        draft: VALID_DRAFT,
        candidates: CANDIDATES,
        error: new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom"),
        attempt: 1,
        mastra: mockMastra(generate),
        timeoutMs: 30_000,
      }),
      "malformed_syntax",
    )
  })

  it("throws RepairDraftError(schema_violation) when the repaired draft still fails the schema", async () => {
    // Parses as JSON but only one block (below GENERATION_MIN_BLOCKS) and the
    // block uses the wrong discriminator field — still off-shape.
    const generate = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: "x",
        metaDescription: "y",
        blocks: [{ type: "text" }],
      }),
    })
    await expectRepairDraftError(
      repairDraft({
        draft: VALID_DRAFT,
        candidates: CANDIDATES,
        error: new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom"),
        attempt: 1,
        mastra: mockMastra(generate),
        timeoutMs: 30_000,
      }),
      "schema_violation",
    )
  })

  it("throws RepairDraftError(timeout) when the agent call aborts", async () => {
    const generate = vi.fn().mockImplementation(async () => {
      const err = new Error("aborted")
      err.name = "TimeoutError"
      throw err
    })
    await expectRepairDraftError(
      repairDraft({
        draft: VALID_DRAFT,
        candidates: CANDIDATES,
        error: new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom"),
        attempt: 1,
        mastra: mockMastra(generate),
        timeoutMs: 30_000,
      }),
      "timeout",
    )
  })

  it("prefers a provider-validated structured object when present", async () => {
    const generate = vi.fn().mockResolvedValue({
      text: "",
      object: VALID_DRAFT,
    })
    const repaired = await repairDraft({
      draft: VALID_DRAFT,
      candidates: CANDIDATES,
      error: new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom"),
      attempt: 1,
      mastra: mockMastra(generate),
      timeoutMs: 30_000,
    })
    expect(repaired.title).toBe(VALID_DRAFT.title)
  })
})
