import { I18nManager } from "react-native"

import { isLayoutRtl, layoutSign } from "../layoutRtl"

function layoutIs(isRTL: boolean) {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL,
  })
}

afterEach(() => jest.restoreAllMocks())

describe("layoutRtl", () => {
  it("reads a right-to-left layout as -1", () => {
    layoutIs(true)
    expect(isLayoutRtl()).toBe(true)
    expect(layoutSign()).toBe(-1)
  })

  it("reads a left-to-right layout as 1", () => {
    layoutIs(false)
    expect(isLayoutRtl()).toBe(false)
    expect(layoutSign()).toBe(1)
  })
})
