import { resolveLanguageDissolve } from "./languageTag"

describe("resolveLanguageDissolve", () => {
  it("crossfades a language change within the same centerpiece", () => {
    expect(
      resolveLanguageDissolve({
        previous: "English",
        next: "Dinka",
        sameExcerpt: true,
        reduceMotion: false,
      }),
    ).toEqual({ current: "Dinka", exiting: "English", crossfade: true })
  })

  it("adopts the language with no fade on a new excerpt (restartKey changed)", () => {
    expect(
      resolveLanguageDissolve({
        previous: "English",
        next: "Dinka",
        sameExcerpt: false,
        reduceMotion: false,
      }),
    ).toEqual({ current: "Dinka", exiting: null, crossfade: false })
  })

  it("adopts with no fade under reduce motion", () => {
    expect(
      resolveLanguageDissolve({
        previous: "English",
        next: "Dinka",
        sameExcerpt: true,
        reduceMotion: true,
      }),
    ).toEqual({ current: "Dinka", exiting: null, crossfade: false })
  })

  it("clears any in-flight dissolve on a non-language re-render (freeze guard)", () => {
    // A reduce-motion (or other dep) change mid-dissolve must tear the exiting pill down
    // rather than leave it frozen at partial opacity over the live pill.
    expect(
      resolveLanguageDissolve({
        previous: "Dinka",
        next: "Dinka",
        sameExcerpt: true,
        reduceMotion: false,
      }),
    ).toEqual({ current: "Dinka", exiting: null, crossfade: false })
  })

  it("does not crossfade from a null previous (the pill's first appearance)", () => {
    expect(
      resolveLanguageDissolve({
        previous: null,
        next: "English",
        sameExcerpt: true,
        reduceMotion: false,
      }),
    ).toEqual({ current: "English", exiting: null, crossfade: false })
  })

  it("adopts null (leaving the centerpiece for an ordinary excerpt) with no fade", () => {
    expect(
      resolveLanguageDissolve({
        previous: "English",
        next: null,
        sameExcerpt: true,
        reduceMotion: false,
      }),
    ).toEqual({ current: null, exiting: null, crossfade: false })
  })
})
