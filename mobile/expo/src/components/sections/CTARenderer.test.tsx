import { createElement } from "react"

import type { CTASection } from "../../lib/sectionModels"
import { CTARenderer } from "./CTARenderer"

const baseSection: CTASection = {
  kind: "cta",
  id: "cta-1",
  sectionKey: "cta-block",
  heading: "Want to grow deeper?",
  body: "Explore free resources to help you on your journey.",
  buttonLabel: "Get Started",
  buttonLink: "https://example.com/resources",
  variant: "primary",
}

describe("CTARenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(CTARenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with minimal fields", () => {
    const minimal: CTASection = {
      ...baseSection,
      heading: null,
      body: null,
      buttonLink: null,
      variant: null,
    }
    expect(() => createElement(CTARenderer, { section: minimal })).not.toThrow()
  })

  it("renders without throwing with primary variant", () => {
    expect(() =>
      createElement(CTARenderer, {
        section: { ...baseSection, variant: "primary" },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with secondary variant", () => {
    expect(() =>
      createElement(CTARenderer, {
        section: { ...baseSection, variant: "secondary" },
      }),
    ).not.toThrow()
  })

  it("renders without throwing when variant is null (defaults to primary)", () => {
    expect(() =>
      createElement(CTARenderer, {
        section: { ...baseSection, variant: null },
      }),
    ).not.toThrow()
  })
})
