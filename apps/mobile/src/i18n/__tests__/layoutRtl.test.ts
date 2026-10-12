import { I18nManager } from "react-native"

import { insetPadding, isLayoutRtl, layoutSign } from "../layoutRtl"

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

  // A notch on the left in landscape: React Native swaps the two paddings in
  // a right-to-left layout, so the helper swaps the insets first.
  it("keeps each inset on its own physical side", () => {
    const insets = { left: 47, right: 0 }
    layoutIs(false)
    expect(insetPadding(insets)).toEqual({ paddingLeft: 47, paddingRight: 0 })
    layoutIs(true)
    expect(insetPadding(insets)).toEqual({ paddingLeft: 0, paddingRight: 47 })
  })
})
