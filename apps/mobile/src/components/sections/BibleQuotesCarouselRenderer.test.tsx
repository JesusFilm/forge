import { createElement } from "react"

import type { BibleQuotesCarouselSection } from "../../lib/sectionModels"
import { BibleQuotesCarouselRenderer } from "./BibleQuotesCarouselRenderer"

const baseSection: BibleQuotesCarouselSection = {
  kind: "bibleQuotesCarousel",
  id: "bq-1",
  sectionKey: "quotes",
  heading: "Scripture Highlights",
  quotes: [
    {
      id: "q1",
      text: "For God so loved the world...",
      reference: "John 3:16",
      attribution: "Apostle John",
      backgroundImage: {
        url: "https://example.com/bg.jpg",
        alternativeText: "Background",
      },
      imageUrl: "https://example.com/image.jpg",
      backgroundColor: "#2C1810",
      ctaLabel: "Read More",
      ctaLink: "https://example.com/read",
    },
    {
      id: "q2",
      text: "I am the way, the truth, and the life.",
      reference: "John 14:6",
      attribution: null,
      backgroundImage: null,
      imageUrl: null,
      backgroundColor: null,
      ctaLabel: null,
      ctaLink: null,
    },
  ],
}

describe("BibleQuotesCarouselRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(BibleQuotesCarouselRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with empty quotes array", () => {
    const empty: BibleQuotesCarouselSection = {
      ...baseSection,
      quotes: [],
    }
    expect(() =>
      createElement(BibleQuotesCarouselRenderer, { section: empty }),
    ).not.toThrow()
  })

  it("renders without throwing with no heading", () => {
    const noHeading: BibleQuotesCarouselSection = {
      ...baseSection,
      heading: null,
    }
    expect(() =>
      createElement(BibleQuotesCarouselRenderer, { section: noHeading }),
    ).not.toThrow()
  })

  it("renders without throwing with imageUrl only (no backgroundImage)", () => {
    const imageUrlOnly: BibleQuotesCarouselSection = {
      ...baseSection,
      quotes: [
        {
          id: "q1",
          text: "Quote text",
          reference: "Ref",
          attribution: null,
          backgroundImage: null,
          imageUrl: "https://example.com/image.jpg",
          backgroundColor: "#1A1815",
          ctaLabel: null,
          ctaLink: null,
        },
      ],
    }
    expect(() =>
      createElement(BibleQuotesCarouselRenderer, { section: imageUrlOnly }),
    ).not.toThrow()
  })

  it("renders without throwing with backgroundImage fallback (no imageUrl)", () => {
    const bgImageFallback: BibleQuotesCarouselSection = {
      ...baseSection,
      quotes: [
        {
          id: "q1",
          text: "Quote text",
          reference: "Ref",
          attribution: null,
          backgroundImage: {
            url: "https://example.com/bg.jpg",
            alternativeText: "Alt text",
          },
          imageUrl: null,
          backgroundColor: null,
          ctaLabel: null,
          ctaLink: null,
        },
      ],
    }
    expect(() =>
      createElement(BibleQuotesCarouselRenderer, { section: bgImageFallback }),
    ).not.toThrow()
  })

  it("renders without throwing with no images (solid color fallback)", () => {
    const noImages: BibleQuotesCarouselSection = {
      ...baseSection,
      quotes: [
        {
          id: "q1",
          text: "Quote text",
          reference: "Ref",
          attribution: null,
          backgroundImage: null,
          imageUrl: null,
          backgroundColor: null,
          ctaLabel: null,
          ctaLink: null,
        },
      ],
    }
    expect(() =>
      createElement(BibleQuotesCarouselRenderer, { section: noImages }),
    ).not.toThrow()
  })
})
