import { pickCardImage } from "./cardImage"

describe("pickCardImage — poster intent", () => {
  it("prefers cinematic (high → low), then thumbnail, then url", () => {
    expect(
      pickCardImage([{ mobileCinematicHigh: "high", url: "u" }], "poster"),
    ).toBe("high")
    expect(
      pickCardImage([{ mobileCinematicLow: "low", thumbnail: "t" }], "poster"),
    ).toBe("low")
    // thumbnail beats the bare url — the variant-less delivery base 400s.
    expect(pickCardImage([{ url: "u", thumbnail: "t" }], "poster")).toBe("t")
    expect(pickCardImage([{ url: "u" }], "poster")).toBe("u")
  })

  it("falls through to a later image's cinematic art (the fix)", () => {
    // A videoStill-first entry has no cinematic field; the sibling entry has it.
    expect(
      pickCardImage([{}, { mobileCinematicHigh: "second" }], "poster"),
    ).toBe("second")
  })

  it("scans field-major: a later cinematic beats an earlier url", () => {
    expect(
      pickCardImage(
        [{ url: "first-url" }, { mobileCinematicHigh: "second-high" }],
        "poster",
      ),
    ).toBe("second-high")
  })

  it("ignores videoStill (a card-only field)", () => {
    expect(pickCardImage([{ videoStill: "still" }], "poster")).toBeNull()
  })
})

describe("pickCardImage — card intent", () => {
  it("applies cinematic → videoStill → thumbnail → url precedence", () => {
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
    // thumbnail beats the bare url here too.
    expect(pickCardImage([{ url: "u", thumbnail: "t" }], "card")).toBe("t")
  })

  it("scans field-major across images, not image-major", () => {
    expect(
      pickCardImage(
        [{ url: "first-url" }, { mobileCinematicHigh: "second-high" }],
        "card",
      ),
    ).toBe("second-high")
    expect(pickCardImage([{}, { url: "second" }], "card")).toBe("second")
  })
})

// Regression: the exact `images` shape admin returns for JESUS → "The Beginning"
// (a videoStill entry sorted FIRST, its `mobileCinematicHigh` null; the cinematic
// art in the second entry). The old poster picker returned images[0].url — a
// variant-less Cloudflare base that 400s — leaving the episode card blank.
describe("pickCardImage — JESUS 'The Beginning' regression", () => {
  const CINEMATIC_HIGH =
    "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/1_jf6101-0-0.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95"
  const VARIANTLESS_URL =
    "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/1_jf6101-0-0.videoStill.jpg"
  const theBeginningImages = [
    {
      url: VARIANTLESS_URL,
      thumbnail:
        "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/1_jf6101-0-0.videoStill.jpg/f=jpg,w=120,h=68,q=95",
      mobileCinematicHigh: null,
      mobileCinematicLow: null,
    },
    {
      url: "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/1_jf6101-0-0.mobileCinematicHigh.jpg",
      thumbnail: null,
      mobileCinematicHigh: CINEMATIC_HIGH,
      mobileCinematicLow:
        "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/1_jf6101-0-0.mobileCinematicHigh.jpg/f=jpg,w=640,h=300,q=95",
    },
  ]

  it("returns the loadable cinematic art, not the variant-less url", () => {
    const poster = pickCardImage(theBeginningImages, "poster")
    expect(poster).toBe(CINEMATIC_HIGH)
    expect(poster).not.toBe(VARIANTLESS_URL)
  })
})

describe("pickCardImage — empty inputs", () => {
  it("returns null for null/undefined/empty", () => {
    expect(pickCardImage(null, "poster")).toBeNull()
    expect(pickCardImage(undefined, "card")).toBeNull()
    expect(pickCardImage([], "poster")).toBeNull()
  })
})
