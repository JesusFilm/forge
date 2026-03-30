import { createElement } from "react"

import type { ContainerSection } from "../../lib/sectionModels"
import { ContainerRenderer } from "./ContainerRenderer"

const baseSection: ContainerSection = {
  kind: "container",
  id: "container-1",
  sectionKey: "grid-block",
  slots: [
    {
      id: "slot-1",
      gridSpan: 6,
      content: [
        {
          kind: "text",
          id: "text-in-slot",
          sectionKey: null,
          heading: "Left column",
          headingLevel: "h2",
          subtitle: null,
          content: ["Text in a grid slot."],
          variant: "default",
        },
      ],
    },
    {
      id: "slot-2",
      gridSpan: 6,
      content: [
        {
          kind: "cta",
          id: "cta-in-slot",
          sectionKey: null,
          heading: "Right column",
          body: null,
          buttonLabel: "Click",
          buttonLink: null,
          variant: "primary",
        },
      ],
    },
  ],
}

describe("ContainerRenderer", () => {
  it("renders without throwing with slots and nested content", () => {
    expect(() =>
      createElement(ContainerRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with empty slots", () => {
    expect(() =>
      createElement(ContainerRenderer, {
        section: { ...baseSection, slots: [] },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with empty slot content", () => {
    expect(() =>
      createElement(ContainerRenderer, {
        section: {
          ...baseSection,
          slots: [{ id: "empty-slot", gridSpan: 12, content: [] }],
        },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with single full-width slot", () => {
    expect(() =>
      createElement(ContainerRenderer, {
        section: {
          ...baseSection,
          slots: [baseSection.slots[0]],
        },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with three-column layout", () => {
    expect(() =>
      createElement(ContainerRenderer, {
        section: {
          ...baseSection,
          slots: [
            { ...baseSection.slots[0], id: "s1", gridSpan: 4 },
            { ...baseSection.slots[1], id: "s2", gridSpan: 4 },
            { ...baseSection.slots[0], id: "s3", gridSpan: 4 },
          ],
        },
      }),
    ).not.toThrow()
  })
})
