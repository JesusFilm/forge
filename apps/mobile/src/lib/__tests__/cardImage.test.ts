import { pickCardImage } from "../cardImage"

describe("pickCardImage", () => {
  it("prefers a variant field over the bare url on the same image", () => {
    expect(
      pickCardImage([{ mobileCinematicHigh: "high", url: "u" }], "card"),
    ).toBe("high")
  })

  it("falls back down the field order within one image", () => {
    expect(
      pickCardImage([{ mobileCinematicLow: "low", url: "u" }], "card"),
    ).toBe("low")
    expect(pickCardImage([{ videoStill: "still", url: "u" }], "card")).toBe(
      "still",
    )
    expect(pickCardImage([{ thumbnail: "thumb", url: "u" }], "card")).toBe(
      "thumb",
    )
  })

  it("uses the bare url only when no variant field exists anywhere", () => {
    expect(pickCardImage([{ url: "u" }], "card")).toBe("u")
  })

  it("scans field-major: a variant-less first image falls through to a sibling", () => {
    expect(
      pickCardImage(
        [{ url: "first-url" }, { mobileCinematicHigh: "second-high" }],
        "card",
      ),
    ).toBe("second-high")
  })

  it("excludes videoStill for the poster intent", () => {
    expect(pickCardImage([{ videoStill: "still", url: "u" }], "poster")).toBe(
      "u",
    )
  })

  it("returns null for empty/absent images", () => {
    expect(pickCardImage([], "card")).toBeNull()
    expect(pickCardImage(null, "card")).toBeNull()
    expect(pickCardImage(undefined, "card")).toBeNull()
    expect(pickCardImage([{}, {}], "card")).toBeNull()
  })

  // Regression, prod data: the "Life of Jesus (Gospel of John)" Up Next card
  // rendered blank because images[0] is videoStill-first and its bare url 400s.
  it("picks the cinematic sibling for a videoStill-first prod record", () => {
    const images = [
      {
        url: "https://imagedelivery.net/tMY/2_GOJ-0-0.videoStill.jpg",
        thumbnail:
          "https://imagedelivery.net/tMY/2_GOJ-0-0.videoStill.jpg/f=jpg,w=120,h=68,q=95",
        mobileCinematicHigh: null,
        mobileCinematicLow: null,
        videoStill:
          "https://imagedelivery.net/tMY/2_GOJ-0-0.videoStill.jpg/f=jpg,w=1920,h=1080,q=95",
      },
      {
        url: "https://imagedelivery.net/tMY/2_GOJ-0-0.mobileCinematicHigh.jpg",
        thumbnail: null,
        mobileCinematicHigh:
          "https://imagedelivery.net/tMY/2_GOJ-0-0.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95",
        mobileCinematicLow:
          "https://imagedelivery.net/tMY/2_GOJ-0-0.mobileCinematicHigh.jpg/f=jpg,w=640,h=300,q=95",
        videoStill: null,
      },
    ]
    expect(pickCardImage(images, "card")).toBe(
      "https://imagedelivery.net/tMY/2_GOJ-0-0.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95",
    )
  })
})
