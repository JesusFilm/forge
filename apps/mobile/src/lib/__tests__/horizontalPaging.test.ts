import { I18nManager } from "react-native"

import { heroSwipeTarget, scrollPageIndex } from "../horizontalPaging"

function layoutIs(isRTL: boolean) {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL,
  })
}

afterEach(() => jest.restoreAllMocks())

const COMMIT_PX = 40

/** A released drag of `dx` from hero 1 of 4, so both neighbours exist. */
function swipeFrom1(dx: number) {
  return heroSwipeTarget({ dx, index: 1, slideCount: 4, commitPx: COMMIT_PX })
}

describe("heroSwipeTarget (feat-692 U5)", () => {
  it("moves to the next hero on a drag to the right in a right-to-left layout", () => {
    layoutIs(true)
    expect(swipeFrom1(60)).toBe(2)
  })

  it("moves back on a drag to the left in a right-to-left layout", () => {
    layoutIs(true)
    expect(swipeFrom1(-60)).toBe(0)
  })

  it("keeps today's rule in a left-to-right layout", () => {
    layoutIs(false)
    expect(swipeFrom1(-60)).toBe(2)
    expect(swipeFrom1(60)).toBe(0)
    // A drag under the commit distance changes nothing.
    expect(swipeFrom1(-30)).toBeNull()
    // The ends hold: no hero after the last one, none before the first.
    expect(
      heroSwipeTarget({
        dx: -60,
        index: 3,
        slideCount: 4,
        commitPx: COMMIT_PX,
      }),
    ).toBe(3)
    expect(
      heroSwipeTarget({ dx: 60, index: 0, slideCount: 4, commitPx: COMMIT_PX }),
    ).toBe(0)
  })
})

describe("scrollPageIndex (feat-692 U5)", () => {
  // Both platforms report contentOffset.x from the left edge of the content,
  // in either layout direction (RCTScrollViewComponentView _scrollViewMetrics,
  // ReactScrollViewHelper.emitScrollEvent).
  type Settle = { x: number; contentWidth: number; viewportWidth: number }
  const event = ({ x, contentWidth, viewportWidth }: Settle) => ({
    contentOffset: { x },
    contentSize: { width: contentWidth },
    layoutMeasurement: { width: viewportWidth },
  })

  // The hero pager: four 400-wide pages in a 400-wide viewport.
  const pager = (x: number) =>
    scrollPageIndex(event({ x, contentWidth: 1600, viewportWidth: 400 }), 400)

  // The quote carousel on a 390-wide screen: five 358-wide cards with 12
  // between them and 16 at each end, so one page is 370.
  const carousel = (x: number) =>
    scrollPageIndex(event({ x, contentWidth: 1870, viewportWidth: 390 }), 370)

  it("counts pages from the right edge in a right-to-left layout", () => {
    layoutIs(true)
    expect(pager(1200)).toBe(0)
    expect(pager(800)).toBe(1)
    expect(pager(0)).toBe(3)
    expect(carousel(370)).toBe(3)
  })

  it("counts pages from the left edge in a left-to-right layout", () => {
    layoutIs(false)
    expect(pager(0)).toBe(0)
    expect(pager(800)).toBe(2)
    expect(carousel(370)).toBe(1)
  })
})
