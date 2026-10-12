import { I18nManager } from "react-native"

import { directionalIcon, type DirectionalIconName } from "../layoutRtl"

function layoutIs(isRTL: boolean) {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL,
  })
}

afterEach(() => jest.restoreAllMocks())

describe("directionalIcon (feat-694 KTD8)", () => {
  it.each([
    ["chevron-back", "chevron-forward"],
    ["chevron-forward", "chevron-back"],
    ["arrow-back", "arrow-forward"],
    ["arrow-forward", "arrow-back"],
  ] as const)(
    "turns %s into %s in a right-to-left layout",
    (name, mirrored) => {
      layoutIs(true)
      expect(directionalIcon(name)).toBe(mirrored)
    },
  )

  it.each(["chevron-back", "chevron-forward", "arrow-back", "arrow-forward"])(
    "keeps %s in a left-to-right layout",
    (name) => {
      layoutIs(false)
      expect(directionalIcon(name as DirectionalIconName)).toBe(name)
    },
  )

  it("never maps a playback icon (R12)", () => {
    layoutIs(true)
    // Not in the type: a playback icon cannot reach the helper at all.
    // @ts-expect-error play-back is not a directional icon
    expect(directionalIcon("play-back")).toBeUndefined()
    // @ts-expect-error play-forward is not a directional icon
    expect(directionalIcon("play-forward")).toBeUndefined()
  })
})
