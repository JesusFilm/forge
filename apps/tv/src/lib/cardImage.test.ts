import { pickCardImage } from "./cardImage"

describe("pickCardImage — poster intent (first image only)", () => {
  it("prefers mobileCinematicHigh, then url, then thumbnail", () => {
    expect(
      pickCardImage([{ mobileCinematicHigh: "high", url: "u" }], "poster"),
    ).toBe("high")
    expect(pickCardImage([{ url: "u", thumbnail: "t" }], "poster")).toBe("u")
    expect(pickCardImage([{ thumbnail: "t" }], "poster")).toBe("t")
  })

  it("never falls through to later images", () => {
    expect(
      pickCardImage([{}, { mobileCinematicHigh: "second" }], "poster"),
    ).toBeNull()
  })

  it("ignores card-only fields (videoStill, mobileCinematicLow)", () => {
    expect(
      pickCardImage(
        [{ videoStill: "still", mobileCinematicLow: "low" }],
        "poster",
      ),
    ).toBeNull()
  })
})

describe("pickCardImage — card intent (scan all images)", () => {
  it("applies the full cinematic precedence per image", () => {
    // Top link: mobileCinematicHigh beats everything below it.
    expect(
      pickCardImage(
        [{ mobileCinematicHigh: "high", mobileCinematicLow: "low" }],
        "card",
      ),
    ).toBe("high")
    expect(
      pickCardImage(
        [{ mobileCinematicLow: "low", videoStill: "still" }],
        "card",
      ),
    ).toBe("low")
    expect(pickCardImage([{ videoStill: "still", url: "u" }], "card")).toBe(
      "still",
    )
    // Bottom link: url beats thumbnail.
    expect(pickCardImage([{ url: "u", thumbnail: "t" }], "card")).toBe("u")
  })

  it("falls through to later images when earlier ones are empty", () => {
    expect(pickCardImage([{}, { url: "second" }], "card")).toBe("second")
  })
})

describe("pickCardImage — empty inputs", () => {
  it("returns null for null/undefined/empty", () => {
    expect(pickCardImage(null, "poster")).toBeNull()
    expect(pickCardImage(undefined, "card")).toBeNull()
    expect(pickCardImage([], "poster")).toBeNull()
  })
})
