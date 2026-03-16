import { createElement } from "react"

import type { SectionWrapperSection } from "../../lib/sectionModels"
import { SectionWrapperRenderer } from "./SectionWrapperRenderer"

const baseSection: SectionWrapperSection = {
  kind: "sectionWrapper",
  id: "sw-1",
  sectionKey: "wrapper-block",
  backgroundColor: "default",
  blurHash: null,
  content: [
    {
      kind: "text",
      id: "text-nested",
      sectionKey: null,
      heading: "Nested heading",
      headingLevel: "h2",
      subtitle: null,
      content: "Some nested text content.",
      variant: "default",
    },
  ],
}

describe("SectionWrapperRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(SectionWrapperRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it.each(["default", "light", "dark", "primary"] as const)(
    "renders without throwing with backgroundColor %s",
    (bg) => {
      expect(() =>
        createElement(SectionWrapperRenderer, {
          section: { ...baseSection, backgroundColor: bg },
        }),
      ).not.toThrow()
    },
  )

  it("renders without throwing with null backgroundColor", () => {
    expect(() =>
      createElement(SectionWrapperRenderer, {
        section: { ...baseSection, backgroundColor: null },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with empty content", () => {
    expect(() =>
      createElement(SectionWrapperRenderer, {
        section: { ...baseSection, content: [] },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with blurHash present", () => {
    expect(() =>
      createElement(SectionWrapperRenderer, {
        section: { ...baseSection, blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with multiple nested items", () => {
    expect(() =>
      createElement(SectionWrapperRenderer, {
        section: {
          ...baseSection,
          content: [
            ...baseSection.content,
            {
              kind: "cta",
              id: "cta-nested",
              sectionKey: null,
              heading: "Nested CTA",
              body: null,
              buttonLabel: "Click",
              buttonLink: null,
              variant: "primary",
            },
          ],
        },
      }),
    ).not.toThrow()
  })
})
