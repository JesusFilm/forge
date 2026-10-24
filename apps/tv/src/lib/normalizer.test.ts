import {
  blockKey,
  normalizeExperience,
  type NormalizedBlock,
  type RawWatchExperience,
} from "./normalizer"

// Admin sends a flat container: ContainerSlotBlock markers divide content[] into
// side-by-side slots. These tests pin the reconstruction that ContainerRenderer
// relies on to lay slots out by span (regression: everything collapsed to one
// stacked column when the markers were dropped).

function experienceWith(content: Record<string, unknown>[]) {
  return normalizeExperience({
    documentId: "exp1",
    slug: "easter",
    title: "Easter",
    blocks: [
      { __typename: "ContainerBlock", sectionKey: "easter-row", content },
    ],
  } as unknown as RawWatchExperience)
}

/** Narrow a normalized section to its container slots (throws if not one). */
function slotsOf(section: { kind: string }) {
  if (section.kind !== "container") throw new Error("expected container")
  return (section as unknown as { slots: Array<Record<string, unknown>> }).slots
}

describe("normalizeExperience — flat container slots", () => {
  it("splits content into one slot per ContainerSlotBlock marker", () => {
    const { sections } = experienceWith([
      { __typename: "ContainerSlotBlock", gridSpan: 6, spans: { xl: 7 } },
      { __typename: "EasterDatesBlock", easterDatesTitle: "When is Easter?" },
      { __typename: "ContainerSlotBlock", gridSpan: 6, spans: { xl: 5 } },
      { __typename: "VideoBlock", videoId: "v1" },
    ])

    const slots = slotsOf(sections[0])
    expect(slots).toHaveLength(2)

    const first = slots[0].slotContent as Array<{ kind: string }>
    const second = slots[1].slotContent as Array<{ kind: string }>
    expect(first).toHaveLength(1)
    expect(first[0].kind).toBe("easterDates")
    expect(second[0].kind).toBe("video")
  })

  it("carries each marker's gridSpan and spans onto its slot", () => {
    const { sections } = experienceWith([
      {
        __typename: "ContainerSlotBlock",
        gridSpan: 7,
        spans: { xl: 8, md: 6 },
      },
      { __typename: "TextBlock", heading: "Left" },
      { __typename: "ContainerSlotBlock", gridSpan: 5, spans: { xl: 4 } },
      { __typename: "TextBlock", heading: "Right" },
    ])

    const slots = slotsOf(sections[0])
    expect(slots[0].gridSpan).toBe(7)
    expect(slots[0].spans).toEqual({ xl: 8, md: 6 })
    expect(slots[1].gridSpan).toBe(5)
    expect(slots[1].spans).toEqual({ xl: 4 })
  })

  it("collapses marker-less content into a single slot (never vanishes)", () => {
    const { sections } = experienceWith([
      { __typename: "EasterDatesBlock", easterDatesTitle: "When is Easter?" },
      { __typename: "VideoBlock", videoId: "v1" },
    ])

    const slots = slotsOf(sections[0])
    expect(slots).toHaveLength(1)
    expect(slots[0].slotContent).toHaveLength(2)
  })

  it("drops unknown block types and prunes the emptied slot", () => {
    const { sections } = experienceWith([
      { __typename: "ContainerSlotBlock", gridSpan: 6 },
      { __typename: "MysteryBlock", foo: "bar" },
      { __typename: "ContainerSlotBlock", gridSpan: 6 },
      { __typename: "VideoBlock", videoId: "v1" },
    ])

    const slots = slotsOf(sections[0])
    expect(slots).toHaveLength(1)
    const only = slots[0].slotContent as Array<{ kind: string }>
    expect(only[0].kind).toBe("video")
  })
})

describe("normalizeExperience — SectionBlock recursion", () => {
  it("normalizes a section wrapper's nested content recursively", () => {
    const { sections } = normalizeExperience({
      documentId: "exp1",
      slug: "s",
      title: "S",
      blocks: [
        {
          __typename: "SectionBlock",
          sectionKey: "s1",
          sectionContent: [
            { __typename: "TextBlock", textHeading: "Hi" },
            { __typename: "VideoBlock", videoId: "v1" },
          ],
        },
      ],
    } as unknown as RawWatchExperience)

    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe("sectionWrapper")
    const content = (
      sections[0] as unknown as { sectionContent: Array<{ kind: string }> }
    ).sectionContent
    expect(content.map((c) => c.kind)).toEqual(["text", "video"])
  })

  it("drops unknown nested types inside a section wrapper", () => {
    const { sections } = normalizeExperience({
      documentId: "exp1",
      slug: "s",
      title: "S",
      blocks: [
        {
          __typename: "SectionBlock",
          sectionKey: "s1",
          sectionContent: [
            { __typename: "MysteryBlock", foo: "bar" },
            { __typename: "VideoBlock", videoId: "v1" },
          ],
        },
      ],
    } as unknown as RawWatchExperience)

    const content = (
      sections[0] as unknown as { sectionContent: Array<{ kind: string }> }
    ).sectionContent
    expect(content.map((c) => c.kind)).toEqual(["video"])
  })
})

describe("blockKey", () => {
  it("returns the sectionKey when it is a string, else undefined", () => {
    expect(
      blockKey({
        kind: "text",
        sectionKey: "foo",
      } as unknown as NormalizedBlock),
    ).toBe("foo")
    expect(
      blockKey({
        kind: "text",
        sectionKey: null,
      } as unknown as NormalizedBlock),
    ).toBeUndefined()
    expect(
      blockKey({ kind: "video" } as unknown as NormalizedBlock),
    ).toBeUndefined()
  })
})
