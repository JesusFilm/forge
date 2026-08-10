import { displayLabel, labelText } from "../videoLabel"

// The detail routes passed admin's raw enum straight through, so users saw the
// literal "FEATURE_FILM" while the home hero showed "FEATURE FILM".
// VideoMetadata now maps at the shared render point.
describe("displayLabel", () => {
  it.each([
    ["FEATURE_FILM", "Feature film"],
    ["SHORT_FILM", "Short film"],
    ["BEHIND_THE_SCENES", "Behind the scenes"],
    ["EPISODE", "Episode"],
    ["SERIES", "Series"],
    ["COLLECTION", "Collection"],
    ["SEGMENT", "Segment"],
    ["TRAILER", "Trailer"],
  ])("maps the %s enum to human text", (raw, expected) => {
    expect(displayLabel(raw)).toBe(expected)
  })

  // The multi-word enums are the only ones that can show an underscore, so they
  // are the cases that actually prove the reported bug is fixed.
  it("never leaks an underscore for a known multi-word enum", () => {
    for (const raw of ["FEATURE_FILM", "SHORT_FILM", "BEHIND_THE_SCENES"]) {
      expect(displayLabel(raw)).not.toContain("_")
    }
  })

  // Pass-through, NOT the home model's "Video" default: VideoMetadata also
  // receives already-humanized labels from the home path, and collapsing those
  // to "Video" would trade one wrong label for another.
  it("passes an already-humanized label through unchanged", () => {
    expect(displayLabel("Feature film")).toBe("Feature film")
  })

  it("passes an unknown label through instead of blanking it", () => {
    expect(displayLabel("DOCUMENTARY")).toBe("DOCUMENTARY")
  })
})

// labelText is the home-model variant: unknown/absent collapses to "Video".
// Keeping both in one file makes the divergent fallbacks impossible to confuse.
describe("labelText", () => {
  it("humanizes a known enum", () => {
    expect(labelText("FEATURE_FILM")).toBe("Feature film")
  })

  it.each([["DOCUMENTARY"], [null], [undefined], [""]])(
    "collapses %s to the generic Video",
    (raw) => {
      expect(labelText(raw as string | null | undefined)).toBe("Video")
    },
  )

  // The divergence is deliberate: displayLabel must NOT collapse an unknown.
  it("diverges from displayLabel on an unknown label", () => {
    expect(labelText("DOCUMENTARY")).toBe("Video")
    expect(displayLabel("DOCUMENTARY")).toBe("DOCUMENTARY")
  })
})
