import { computeBackdropGate, isAppStateForeground } from "./videoBackdropGate"

// The unmuted Experience hero is the only gate combination that hinges on all
// four inputs; the muted siblings must reduce to today's overlay-only behavior.
const hero = {
  muted: false,
  active: true,
  overlayVisible: false,
  appForeground: true,
}

describe("computeBackdropGate — muted siblings (watch/Home/Search)", () => {
  const sibling = { ...hero, muted: true }

  it("plays + mounts on-screen with no overlay, ignoring appForeground (default-inert, KTD1)", () => {
    expect(computeBackdropGate({ ...sibling, appForeground: false })).toEqual({
      shouldPlay: true,
      shouldMountVideo: true,
    })
  })

  it("pauses + unmounts while the overlay is open (unchanged legacy gate)", () => {
    expect(computeBackdropGate({ ...sibling, overlayVisible: true })).toEqual({
      shouldPlay: false,
      shouldMountVideo: false,
    })
  })
})

describe("computeBackdropGate — unmuted Experience hero", () => {
  it("plays + mounts when active, on-screen, and foreground", () => {
    expect(computeBackdropGate(hero)).toEqual({
      shouldPlay: true,
      shouldMountVideo: true,
    })
  })

  it("scroll-off (active=false) pauses but STAYS mounted for instant resume (R10/AE2)", () => {
    expect(computeBackdropGate({ ...hero, active: false })).toEqual({
      shouldPlay: false,
      shouldMountVideo: true,
    })
  })

  it("overlay-open unmounts to release the decode slot (R11/AE1)", () => {
    expect(computeBackdropGate({ ...hero, overlayVisible: true })).toEqual({
      shouldPlay: false,
      shouldMountVideo: false,
    })
  })

  it("background (appForeground=false) unmounts + stops audio (R15)", () => {
    expect(computeBackdropGate({ ...hero, appForeground: false })).toEqual({
      shouldPlay: false,
      shouldMountVideo: false,
    })
  })

  it("never plays while off-screen even if foreground (scroll gate wins)", () => {
    expect(
      computeBackdropGate({ ...hero, active: false, appForeground: true })
        .shouldPlay,
    ).toBe(false)
  })
})

describe("isAppStateForeground", () => {
  it("active is foreground", () => {
    expect(isAppStateForeground("active")).toBe(true)
  })

  it("background is NOT foreground — tears down the sound hero (R15)", () => {
    expect(isAppStateForeground("background")).toBe(false)
  })

  it("transient inactive stays foreground — Control Center/Siri is not teardown", () => {
    expect(isAppStateForeground("inactive")).toBe(true)
  })
})
