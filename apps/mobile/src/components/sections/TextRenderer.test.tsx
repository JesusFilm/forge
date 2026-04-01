import { createElement } from "react"

import type { TextSection } from "../../lib/sectionModels"
import { TextRenderer } from "./TextRenderer"

const baseSection: TextSection = {
  kind: "text",
  id: "txt-1",
  sectionKey: "text-block",
  heading: "The Real Easter Story",
  headingLevel: "h2",
  subtitle: "Discover the meaning behind the celebration",
  content: [
    "Easter is more than just a holiday.",
    "It is the celebration of hope.",
  ],
  variant: "default",
}

describe("TextRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(TextRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with minimal fields", () => {
    const minimal: TextSection = {
      ...baseSection,
      heading: null,
      headingLevel: null,
      subtitle: null,
      variant: null,
    }
    expect(() =>
      createElement(TextRenderer, { section: minimal }),
    ).not.toThrow()
  })

  it("renders without throwing with lead variant", () => {
    expect(() =>
      createElement(TextRenderer, {
        section: { ...baseSection, variant: "lead" },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with small variant", () => {
    expect(() =>
      createElement(TextRenderer, {
        section: { ...baseSection, variant: "small" },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with single paragraph", () => {
    expect(() =>
      createElement(TextRenderer, {
        section: { ...baseSection, content: ["Only one paragraph."] },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with empty content", () => {
    expect(() =>
      createElement(TextRenderer, {
        section: { ...baseSection, content: [] },
      }),
    ).not.toThrow()
  })

  it.each(["h1", "h2", "h3", "h4", "h5", "h6"] as const)(
    "renders without throwing with headingLevel %s",
    (level) => {
      expect(() =>
        createElement(TextRenderer, {
          section: { ...baseSection, headingLevel: level },
        }),
      ).not.toThrow()
    },
  )
})
