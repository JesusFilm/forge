// The verse area (feat-551 KTD16, R7, R10): a box symmetric about the
// screen's vertical center, so a centered verse never runs under an obstacle.
import {
  MIN_CENTERED_VERSE_HEIGHT,
  VERSE_BOX_GAP,
  verseBox,
  type VerseBoxInput,
} from "../verseBox"

function edges(input: VerseBoxInput) {
  const box = verseBox(input)
  return { ...box, bottom: box.top + box.height }
}

describe("verseBox", () => {
  it("centers the box on the whole screen", () => {
    const box = verseBox({
      containerHeight: 900,
      topChromeBottom: 120,
      bottomChromeTop: 780,
    })
    expect(box.top + box.height / 2).toBe(450)
  })

  it("keeps a gap between the verse and each obstacle", () => {
    const box = edges({
      containerHeight: 900,
      topChromeBottom: 120,
      bottomChromeTop: 780,
    })
    expect(box.top).toBe(120 + VERSE_BOX_GAP)
    expect(box.bottom).toBe(780 - VERSE_BOX_GAP)
  })

  it("shrinks both halves when the top band is taller than the bottom one", () => {
    // Top distance 150 - gap, bottom distance 330 - gap: the smaller one wins
    // on BOTH sides, so a long centered verse clears the top band too.
    const box = edges({
      containerHeight: 900,
      topChromeBottom: 300,
      bottomChromeTop: 780,
    })
    expect(box.top).toBe(300 + VERSE_BOX_GAP)
    expect(box.bottom).toBe(600 - VERSE_BOX_GAP)
    expect(box.top + box.height / 2).toBe(450)
    expect(box.top).toBeGreaterThanOrEqual(300)
    expect(box.bottom).toBeLessThanOrEqual(780)
  })

  it("shrinks both halves when the bottom band is taller", () => {
    const box = edges({
      containerHeight: 900,
      topChromeBottom: 100,
      bottomChromeTop: 560,
    })
    expect(box.top).toBe(340 + VERSE_BOX_GAP)
    expect(box.bottom).toBe(560 - VERSE_BOX_GAP)
  })

  it("treats a window in a top corner as a top obstacle (phone start corner)", () => {
    const withWindow = edges({
      containerHeight: 956,
      topChromeBottom: 118,
      bottomChromeTop: 808,
      floating: [{ y: 118, height: 140 }],
    })
    expect(withWindow.top).toBe(258 + VERSE_BOX_GAP)
    expect(withWindow.bottom).toBe(956 - 258 - VERSE_BOX_GAP)
  })

  it("treats a window in a bottom corner as a bottom obstacle (iPad start corner)", () => {
    const box = edges({
      containerHeight: 1000,
      topChromeBottom: 100,
      bottomChromeTop: 900,
      floating: [{ y: 700, height: 200 }],
    })
    expect(box.bottom).toBe(700 - VERSE_BOX_GAP)
    expect(box.top).toBe(300 + VERSE_BOX_GAP)
  })

  it("grows back when the window leaves", () => {
    const input = {
      containerHeight: 956,
      topChromeBottom: 118,
      bottomChromeTop: 808,
    }
    const covered = verseBox({ ...input, floating: [{ y: 118, height: 140 }] })
    const clear = verseBox({ ...input, floating: [] })
    expect(clear.height).toBeGreaterThan(covered.height)
    expect(clear).toEqual(verseBox(input))
  })

  it("follows the window to another corner", () => {
    const input = {
      containerHeight: 956,
      topChromeBottom: 118,
      bottomChromeTop: 808,
    }
    const top = verseBox({ ...input, floating: [{ y: 118, height: 140 }] })
    const bottom = verseBox({ ...input, floating: [{ y: 668, height: 140 }] })
    // The phone chrome is 118 on top and 148 below, so the bottom corner
    // sits deeper into the half it takes.
    expect(top.top).toBe(258 + VERSE_BOX_GAP)
    expect(bottom.top + bottom.height).toBe(668 - VERSE_BOX_GAP)
    expect(bottom.height).not.toBe(top.height)
  })

  // KD27. Close to the iPhone SE (667pt) Bible tab: the top bar ends near
  // 70, the footer starts near 478, and a bottom-corner window spans 336-425.
  const shortScreen = {
    containerHeight: 667,
    topChromeBottom: 70,
    bottomChromeTop: 478,
  }

  it("moves the box into the free space when the centered box collapses", () => {
    const box = edges({
      ...shortScreen,
      floating: [{ y: 336, height: 89 }],
    })
    expect(box.top).toBe(70 + VERSE_BOX_GAP)
    expect(box.bottom).toBe(336 - VERSE_BOX_GAP)
  })

  it("keeps the centered box at the smallest centered height", () => {
    // Half height 80 above and below the center: exactly the minimum.
    const center = 667 / 2
    const box = edges({
      ...shortScreen,
      floating: [{ y: center + 80 + VERSE_BOX_GAP, height: 89 }],
    })
    expect(box.height).toBe(MIN_CENTERED_VERSE_HEIGHT)
    expect(box.top + box.height / 2).toBe(center)
  })

  it("moves the box when the centered one is half a point short", () => {
    const center = 667 / 2
    const windowTop = center + 80 + VERSE_BOX_GAP - 0.5
    const box = edges({
      ...shortScreen,
      floating: [{ y: windowTop, height: 89 }],
    })
    expect(box.top).toBe(70 + VERSE_BOX_GAP)
    expect(box.bottom).toBe(windowTop - VERSE_BOX_GAP)
  })

  it("keeps the phone and iPad start corners centered", () => {
    const phone = verseBox({
      containerHeight: 956,
      topChromeBottom: 118,
      bottomChromeTop: 808,
      floating: [{ y: 118, height: 140 }],
    })
    const ipad = verseBox({
      containerHeight: 1000,
      topChromeBottom: 100,
      bottomChromeTop: 900,
      floating: [{ y: 700, height: 200 }],
    })
    expect(phone.top + phone.height / 2).toBe(478)
    expect(ipad.top + ipad.height / 2).toBe(500)
  })

  it("never returns a negative box when obstacles meet at the center", () => {
    const box = verseBox({
      containerHeight: 400,
      topChromeBottom: 300,
      bottomChromeTop: 100,
    })
    expect(box.height).toBe(0)
    expect(box.top).toBe(200)
  })
})
