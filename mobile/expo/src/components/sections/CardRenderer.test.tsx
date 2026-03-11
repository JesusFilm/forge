import { createElement } from "react"

import type { CardSection } from "../../lib/sectionModels"
import { CardRenderer } from "./CardRenderer"

const baseSection: CardSection = {
  kind: "card",
  id: "card-1",
  sectionKey: "promo",
  title: "Explore the Easter Story",
  description:
    "Discover the meaning behind the celebration with these resources.",
  media: {
    url: "https://example.com/card.jpg",
    alternativeText: "Easter card image",
  },
  link: "https://example.com/easter",
  variant: "default",
}

describe("CardRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(CardRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with minimal fields", () => {
    const minimal: CardSection = {
      ...baseSection,
      media: null,
      link: null,
      variant: null,
    }
    expect(() =>
      createElement(CardRenderer, { section: minimal }),
    ).not.toThrow()
  })

  it("renders without throwing with featured variant", () => {
    expect(() =>
      createElement(CardRenderer, {
        section: { ...baseSection, variant: "featured" },
      }),
    ).not.toThrow()
  })

  it("renders without throwing without link (non-tappable)", () => {
    expect(() =>
      createElement(CardRenderer, {
        section: { ...baseSection, link: null },
      }),
    ).not.toThrow()
  })

  it("renders without throwing without media", () => {
    expect(() =>
      createElement(CardRenderer, {
        section: { ...baseSection, media: null },
      }),
    ).not.toThrow()
  })
})
