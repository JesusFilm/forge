import { describe, expect, it } from "vitest"

import {
  applyDiff,
  computeDiff,
  isEmptyDiff,
  revertDiff,
  InvariantError,
  RevertConflictError,
  type EditableLocaleState,
} from "./experience-chat-diff"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function state(
  overrides: Partial<EditableLocaleState> = {},
): EditableLocaleState {
  return {
    title: "Default Title",
    metaDescription: "Default meta",
    blocks: [
      { id: "b1", kind: "hero", headline: "Hello" },
      { id: "b2", kind: "text", body: "Para" },
      { id: "b3", kind: "video", videoId: "v1" },
    ],
    ogImageUrl: null,
    ...overrides,
  }
}

const pairs: Array<{
  name: string
  before: EditableLocaleState
  after: EditableLocaleState
}> = [
  {
    name: "title change",
    before: state(),
    after: state({ title: "New Title" }),
  },
  {
    name: "metaDescription null -> string",
    before: state({ metaDescription: null }),
    after: state({ metaDescription: "now set" }),
  },
  {
    name: "metaDescription string -> null",
    before: state({ metaDescription: "was set" }),
    after: state({ metaDescription: null }),
  },
  {
    name: "ogImageUrl set",
    before: state(),
    after: state({ ogImageUrl: "https://cdn/img.png" }),
  },
  {
    name: "block insertion at start",
    before: state(),
    after: state({
      blocks: [
        { id: "b0", kind: "banner", text: "promo" },
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b2", kind: "text", body: "Para" },
        { id: "b3", kind: "video", videoId: "v1" },
      ],
    }),
  },
  {
    name: "block insertion at end",
    before: state(),
    after: state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b2", kind: "text", body: "Para" },
        { id: "b3", kind: "video", videoId: "v1" },
        { id: "b4", kind: "footer", text: "bye" },
      ],
    }),
  },
  {
    name: "block insertion in middle",
    before: state(),
    after: state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b1.5", kind: "text", body: "inserted" },
        { id: "b2", kind: "text", body: "Para" },
        { id: "b3", kind: "video", videoId: "v1" },
      ],
    }),
  },
  {
    name: "block deletion at start",
    before: state(),
    after: state({
      blocks: [
        { id: "b2", kind: "text", body: "Para" },
        { id: "b3", kind: "video", videoId: "v1" },
      ],
    }),
  },
  {
    name: "block deletion at end",
    before: state(),
    after: state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b2", kind: "text", body: "Para" },
      ],
    }),
  },
  {
    name: "block deletion in middle",
    before: state(),
    after: state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b3", kind: "video", videoId: "v1" },
      ],
    }),
  },
  {
    name: "deeply nested change inside a block",
    before: state(),
    after: state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Updated headline" },
        { id: "b2", kind: "text", body: "Para" },
        { id: "b3", kind: "video", videoId: "v1" },
      ],
    }),
  },
  {
    name: "scalar empty-string -> value",
    before: state({ title: "" }),
    after: state({ title: "x" }),
  },
  {
    name: "value -> empty-string",
    before: state({ title: "x" }),
    after: state({ title: "" }),
  },
  {
    name: "multiple scalars + blocks change together",
    before: state(),
    after: state({
      title: "Combined",
      metaDescription: "Combined meta",
      ogImageUrl: "https://cdn/og.png",
      blocks: [
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b3", kind: "video", videoId: "v1" },
      ],
    }),
  },
]

/* ------------------------------------------------------------------ */
/*  computeDiff + applyDiff round-trip                                 */
/* ------------------------------------------------------------------ */

describe("computeDiff / applyDiff round-trip", () => {
  for (const { name, before, after } of pairs) {
    it(`applyDiff(before, computeDiff(before, after)) === after — ${name}`, () => {
      const diff = computeDiff(before, after)
      const result = applyDiff(before, diff)
      expect(result).toEqual(after)
    })
  }
})

describe("revertDiff round-trip", () => {
  for (const { name, before, after } of pairs) {
    it(`revertDiff(after, computeDiff(before, after)) === before — ${name}`, () => {
      const diff = computeDiff(before, after)
      const result = revertDiff(after, diff)
      expect(result).toEqual(before)
    })
  }
})

/* ------------------------------------------------------------------ */
/*  Block reorder (swap adjacent)                                       */
/* ------------------------------------------------------------------ */

describe("block reorder (swap adjacent)", () => {
  const before = state()
  const after = state({
    blocks: [
      { id: "b2", kind: "text", body: "Para" },
      { id: "b1", kind: "hero", headline: "Hello" },
      { id: "b3", kind: "video", videoId: "v1" },
    ],
  })

  it("apply round-trips", () => {
    const diff = computeDiff(before, after)
    expect(applyDiff(before, diff)).toEqual(after)
  })

  it("revert round-trips", () => {
    const diff = computeDiff(before, after)
    expect(revertDiff(after, diff)).toEqual(before)
  })
})

/* ------------------------------------------------------------------ */
/*  No-change / empty diff                                              */
/* ------------------------------------------------------------------ */

describe("no-change diff", () => {
  it("isEmptyDiff(computeDiff(s, s)) is true", () => {
    const s = state()
    expect(isEmptyDiff(computeDiff(s, s))).toBe(true)
  })

  it("applyDiff(s, computeDiff(s, s)) deep-equals s", () => {
    const s = state()
    expect(applyDiff(s, computeDiff(s, s))).toEqual(s)
  })

  it("computeDiff(s, s) has empty scalars and undefined-or-empty blocks", () => {
    const s = state()
    const d = computeDiff(s, s)
    expect(Object.keys(d.scalars)).toHaveLength(0)
    expect(d.blocks === undefined || d.blocks.length === 0).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  Immutability                                                        */
/* ------------------------------------------------------------------ */

describe("immutability", () => {
  it("applyDiff does not mutate input state", () => {
    const before = state()
    const beforeSnapshot = JSON.parse(JSON.stringify(before))
    const after = state({ title: "Mutated?" })
    const diff = computeDiff(before, after)
    applyDiff(before, diff)
    expect(before).toEqual(beforeSnapshot)
  })

  it("revertDiff does not mutate input state", () => {
    const before = state()
    const after = state({ title: "X" })
    const diff = computeDiff(before, after)
    const afterSnapshot = JSON.parse(JSON.stringify(after))
    revertDiff(after, diff)
    expect(after).toEqual(afterSnapshot)
  })
})

/* ------------------------------------------------------------------ */
/*  Error paths                                                         */
/* ------------------------------------------------------------------ */

describe("InvariantError on embedding key", () => {
  it("throws when before contains embedding", () => {
    const before = {
      ...state(),
      embedding: [0.1, 0.2],
    } as unknown as EditableLocaleState
    const after = state()
    expect(() => computeDiff(before, after)).toThrow(InvariantError)
  })

  it("throws when after contains embedding", () => {
    const before = state()
    const after = {
      ...state(),
      embedding: [0.1, 0.2],
    } as unknown as EditableLocaleState
    expect(() => computeDiff(before, after)).toThrow(InvariantError)
  })
})

describe("RevertConflictError", () => {
  it("throws when state.title differs from diff.scalars.title.after", () => {
    const before = state({ title: "A" })
    const after = state({ title: "B" })
    const diff = computeDiff(before, after)
    const drifted = state({ title: "C" }) // not B
    let caught: unknown
    try {
      revertDiff(drifted, diff)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RevertConflictError)
    expect((caught as RevertConflictError).field).toBe("title")
  })

  it("throws when blocks have drifted from where the patch expects to start", () => {
    const before = state()
    const after = state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Hello" },
        { id: "b2", kind: "text", body: "Para" },
      ],
    })
    const diff = computeDiff(before, after)
    // Drifted: not equal to `after`, so the inverse patch will not produce `before`.
    const drifted = state({
      blocks: [
        { id: "b1", kind: "hero", headline: "Different" },
        { id: "b2", kind: "text", body: "Para" },
      ],
    })
    let caught: unknown
    try {
      revertDiff(drifted, diff)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RevertConflictError)
    expect((caught as RevertConflictError).field).toBe("blocks")
  })
})
