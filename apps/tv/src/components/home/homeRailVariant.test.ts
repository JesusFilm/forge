import { resolveHomeRailVariant } from "./homeRailVariant"
import type { WatchHomeSection } from "../../lib/watchHome/model"

function section(overrides: Partial<WatchHomeSection>): WatchHomeSection {
  return {
    id: "s",
    eyebrow: "",
    title: "Section",
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    isPosterRail: false,
    cards: [],
    ...overrides,
  }
}

describe("resolveHomeRailVariant", () => {
  it("renders a curated poster rail portrait", () => {
    expect(resolveHomeRailVariant(section({ isPosterRail: true }))).toBe(
      "portrait",
    )
  })

  it("renders a normal rail landscape", () => {
    expect(resolveHomeRailVariant(section({ isPosterRail: false }))).toBe(
      "landscape",
    )
  })

  // THE REGRESSION GUARD. orientation "vertical" reaches the model from three
  // producers and only one implies portrait art: config declares it on two
  // sections, and mapVariant("collection") returns it for poster-less blocks.
  // Both carry the video's LANDSCAPE cinematic — framing them 2:3 crops to a
  // ~31% sliver, the exact bug this feature exists to prevent. The variant must
  // follow isPosterRail alone, never orientation.
  it("stays landscape for orientation=vertical without poster art", () => {
    expect(
      resolveHomeRailVariant(
        section({ orientation: "vertical", isPosterRail: false }),
      ),
    ).toBe("landscape")
  })

  it("goes portrait for a poster rail even when orientation is horizontal", () => {
    expect(
      resolveHomeRailVariant(
        section({ orientation: "horizontal", isPosterRail: true }),
      ),
    ).toBe("portrait")
  })
})
