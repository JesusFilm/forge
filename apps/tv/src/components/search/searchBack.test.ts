import { navigateBackFromSearch } from "./searchBack"

describe("navigateBackFromSearch", () => {
  it("pops Search when it was opened from Home", () => {
    const router = {
      canGoBack: jest.fn(() => true),
      back: jest.fn(),
      replace: jest.fn(),
    }

    expect(navigateBackFromSearch(router)).toBe(true)
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it("replaces a root Search route with Home", () => {
    const router = {
      canGoBack: jest.fn(() => false),
      back: jest.fn(),
      replace: jest.fn(),
    }

    expect(navigateBackFromSearch(router)).toBe(true)
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith("/")
  })
})
