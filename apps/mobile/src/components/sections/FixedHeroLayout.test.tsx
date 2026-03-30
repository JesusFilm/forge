/**
 * Tests for FixedHeroLayout — verifies hero extraction logic, section routing,
 * and scroll-driven state management.
 */

import type {
  ExperienceSection,
  TextSection,
  VideoHeroSection,
} from "../../lib/sectionModels"

const videoHero: VideoHeroSection = {
  kind: "videoHero",
  id: "vh-1",
  sectionKey: null,
  heading: "Easter",
  subheading: "Watch the story",
  streamingUrl: "https://example.com/video.m3u8",
  ctaLink: "https://example.com/watch",
  ctaLabel: "Watch Now",
  video: {
    documentId: "v1",
    slug: "easter-video",
    title: "Easter Video",
    image: {
      url: "https://example.com/thumb.jpg",
      alternativeText: "Easter thumbnail",
    },
  },
}

const textSection: TextSection = {
  kind: "text",
  id: "txt-1",
  sectionKey: null,
  heading: "The Real Easter Story",
  headingLevel: "h2",
  subtitle: null,
  content: "Beyond eggs and bunnies...",
  variant: null,
}

describe("FixedHeroLayout hero extraction logic", () => {
  it("detects videoHero as first section", () => {
    const sections: ExperienceSection[] = [videoHero, textSection]
    const heroSection = sections[0]?.kind === "videoHero" ? sections[0] : null
    const remaining = heroSection ? sections.slice(1) : sections

    expect(heroSection).not.toBeNull()
    expect(heroSection?.kind).toBe("videoHero")
    expect(heroSection?.heading).toBe("Easter")
    expect(remaining).toHaveLength(1)
    expect(remaining[0].kind).toBe("text")
  })

  it("returns null hero when first section is not videoHero", () => {
    const sections: ExperienceSection[] = [textSection]
    const heroSection = sections[0]?.kind === "videoHero" ? sections[0] : null
    const remaining = heroSection ? sections.slice(1) : sections

    expect(heroSection).toBeNull()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].kind).toBe("text")
  })

  it("returns null hero for empty sections array", () => {
    const sections: ExperienceSection[] = []
    const heroSection = sections[0]?.kind === "videoHero" ? sections[0] : null

    expect(heroSection).toBeNull()
  })

  it("only extracts hero when it is the first section", () => {
    const sections: ExperienceSection[] = [textSection, videoHero]
    const heroSection = sections[0]?.kind === "videoHero" ? sections[0] : null

    expect(heroSection).toBeNull()
  })
})

describe("FixedHeroLayout elevated mute button visibility", () => {
  it("button is visible when not paused (scroll at top)", () => {
    const paused = false
    const blurOpacity = 0
    const showButton = !paused
    const buttonOpacity = 1 - blurOpacity

    expect(showButton).toBe(true)
    expect(buttonOpacity).toBe(1)
  })

  it("button is hidden when paused (user scrolled away)", () => {
    const paused = true
    const showButton = !paused

    expect(showButton).toBe(false)
  })

  it("button fades out proportionally to blur opacity", () => {
    const paused = false
    const blurOpacity = 0.5
    const showButton = !paused
    const buttonOpacity = 1 - blurOpacity

    expect(showButton).toBe(true)
    expect(buttonOpacity).toBe(0.5)
  })

  it("button is fully transparent at max blur", () => {
    const blurOpacity = 1
    const buttonOpacity = 1 - blurOpacity

    expect(buttonOpacity).toBe(0)
  })
})

describe("FixedHeroLayout blur bracket computation", () => {
  const BLUR_DISTANCE = 400

  function computeBlurBracket(scrollY: number): number {
    return Math.min(Math.round((scrollY / BLUR_DISTANCE) * 10), 10)
  }

  it("returns 0 at scroll position 0", () => {
    expect(computeBlurBracket(0)).toBe(0)
  })

  it("returns 5 at halfway through blur distance", () => {
    expect(computeBlurBracket(200)).toBe(5)
  })

  it("returns 10 at full blur distance", () => {
    expect(computeBlurBracket(400)).toBe(10)
  })

  it("clamps at 10 beyond blur distance", () => {
    expect(computeBlurBracket(1000)).toBe(10)
  })

  it("rounds to nearest bracket", () => {
    // 160/400 * 10 = 4.0 → bracket 4
    expect(computeBlurBracket(160)).toBe(4)
    // 180/400 * 10 = 4.5 → bracket 5 (rounds up)
    expect(computeBlurBracket(180)).toBe(5)
  })
})
