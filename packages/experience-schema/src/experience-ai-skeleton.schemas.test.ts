import { describe, expect, it } from "vitest"

import {
  FILL_SCHEMAS_BY_TYPE,
  GENERATION_MIN_BLOCKS,
  getFillSchemaForType,
  SKELETON_CONTAINER_TYPES,
  SKELETON_SECTION_TYPES,
  SKELETON_TOP_LEVEL_TYPES,
  validateSkeleton,
} from "./experience-ai.schemas"

/**
 * U3 — skeleton structural validator + per-variant flat fill schemas.
 * Branch-shape tests: every rejection branch has a fixture where ONLY it
 * matches (per the mocked-vs-real discipline learning).
 */
describe("validateSkeleton (U3)", () => {
  const okSkeleton = {
    nodes: [
      { type: "videoHero", sectionRef: "s01" },
      { type: "section", sectionRef: "s02", children: [{ type: "text" }] },
      { type: "cta" },
    ],
  }

  it("accepts a structurally-valid skeleton and returns ok + parsed skeleton", () => {
    const result = validateSkeleton(okSkeleton)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.skeleton.nodes).toHaveLength(3)
      // Order preserved into the parsed skeleton (the array IS the order).
      expect(result.skeleton.nodes.map((n) => n.type)).toEqual([
        "videoHero",
        "section",
        "cta",
      ])
    }
  })

  it("rejects a non-object / malformed input as malformed_skeleton", () => {
    const result = validateSkeleton({ nope: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("malformed_skeleton")
  })

  it("rejects a bare-array input that does not carry { nodes }", () => {
    // validateSkeleton expects the { nodes } envelope; the workflow's
    // liftSkeletonEnvelope is what tolerates a bare array.
    const result = validateSkeleton([{ type: "text" }, { type: "cta" }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("malformed_skeleton")
  })

  it("rejects fewer than GENERATION_MIN_BLOCKS top-level nodes", () => {
    const result = validateSkeleton({ nodes: [{ type: "text" }] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("too_few_top_level_nodes")
      expect(result.message).toContain(String(GENERATION_MIN_BLOCKS))
    }
  })

  it("rejects an unknown top-level block type", () => {
    const result = validateSkeleton({
      nodes: [{ type: "text" }, { type: "totallyMadeUp" }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("unknown_block_type")
  })

  it("rejects a section nested inside a section (AE1 — scoped nesting)", () => {
    const result = validateSkeleton({
      nodes: [
        { type: "videoHero" },
        {
          type: "section",
          children: [{ type: "section", children: [{ type: "text" }] }],
        },
      ],
    })
    expect(result.ok).toBe(false)
    // `section` is not in SKELETON_SECTION_TYPES, so the inner section is
    // an unknown-for-this-scope type.
    if (!result.ok) expect(result.code).toBe("unknown_block_type")
  })

  it("rejects a quizButton at top level (scope-restricted to section)", () => {
    const result = validateSkeleton({
      nodes: [{ type: "videoHero" }, { type: "quizButton" }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("unknown_block_type")
  })

  it("accepts a quizButton INSIDE a section (control for the scope rule)", () => {
    const result = validateSkeleton({
      nodes: [
        { type: "videoHero" },
        { type: "section", children: [{ type: "quizButton" }] },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it("rejects a section / container with zero children (missing_children)", () => {
    const result = validateSkeleton({
      nodes: [{ type: "videoHero" }, { type: "section", children: [] }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_children")
  })

  it("rejects a leaf node that declares children (illegal_nesting)", () => {
    const result = validateSkeleton({
      nodes: [
        { type: "videoHero" },
        { type: "text", children: [{ type: "cta" }] },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("illegal_nesting")
  })

  it("validates container child scope (container child must be a container-scope type)", () => {
    // `section` is not a valid container child → unknown_block_type in
    // container scope.
    const result = validateSkeleton({
      nodes: [
        { type: "videoHero" },
        {
          type: "container",
          children: [{ type: "section", children: [{ type: "text" }] }],
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("unknown_block_type")
  })
})

describe("skeleton scope type sets (U3)", () => {
  it("top-level includes the nesting + leaf types, excludes nothing legitimate", () => {
    expect(SKELETON_TOP_LEVEL_TYPES.has("section")).toBe(true)
    expect(SKELETON_TOP_LEVEL_TYPES.has("container")).toBe(true)
    expect(SKELETON_TOP_LEVEL_TYPES.has("videoHero")).toBe(true)
    expect(SKELETON_TOP_LEVEL_TYPES.has("quizButton")).toBe(false)
  })

  it("section scope allows quizButton + container but NOT section (no section-in-section)", () => {
    expect(SKELETON_SECTION_TYPES.has("quizButton")).toBe(true)
    expect(SKELETON_SECTION_TYPES.has("container")).toBe(true)
    expect(SKELETON_SECTION_TYPES.has("section")).toBe(false)
  })

  it("container scope excludes section + quizButton", () => {
    expect(SKELETON_CONTAINER_TYPES.has("section")).toBe(false)
    expect(SKELETON_CONTAINER_TYPES.has("quizButton")).toBe(false)
    expect(SKELETON_CONTAINER_TYPES.has("text")).toBe(true)
  })
})

describe("per-variant flat fill schemas (U3)", () => {
  it("has a flat schema for every fillable (non-shell) block type", () => {
    // section / container are shells, assembled structurally — not filled.
    expect(getFillSchemaForType("section")).toBeUndefined()
    expect(getFillSchemaForType("container")).toBeUndefined()
    expect(getFillSchemaForType("totallyUnknown")).toBeUndefined()
    // Representative fillable types resolve.
    expect(getFillSchemaForType("text")).toBeDefined()
    expect(getFillSchemaForType("videoHero")).toBeDefined()
    expect(getFillSchemaForType("cta")).toBeDefined()
  })

  it("each fill schema is a single flat object keyed by its `t` literal (not an anyOf)", () => {
    const textSchema = FILL_SCHEMAS_BY_TYPE.text
    const good = textSchema.safeParse({
      t: "text",
      heading: "Hope",
      contentParagraphs: ["Anchored."],
    })
    expect(good.success).toBe(true)
    // A mismatched discriminator fails the flat schema (proving it is the
    // single-variant schema, not a permissive union).
    const wrong = textSchema.safeParse({ t: "cta", buttonLabel: "x" })
    expect(wrong.success).toBe(false)
  })

  it("rejects unknown keys (the variant schema stays strict)", () => {
    const result = FILL_SCHEMAS_BY_TYPE.cta.safeParse({
      t: "cta",
      buttonLabel: "Watch",
      bogusField: "x",
    })
    expect(result.success).toBe(false)
  })
})
