import {
  ANDROID_BUTTON_LIMIT,
  androidActions,
  iosSheetOptions,
  type MenuAction,
} from "../actionMenu"

const CHANGE: MenuAction = { text: "Change quality or subtitles" }
const SAVE: MenuAction = { text: "Save to Photos" }
const REMOVE: MenuAction = {
  text: "Remove all downloads",
  style: "destructive",
}
const CANCEL: MenuAction = { text: "Cancel", style: "cancel" }

describe("iosSheetOptions", () => {
  it("derives both indices from the list, so an inserted option moves them", () => {
    const without = iosSheetOptions([CHANGE, REMOVE, CANCEL])
    expect(without.destructiveButtonIndex).toBe(1)
    expect(without.cancelButtonIndex).toBe(2)

    // The whole reason the indices are derived: the export option is
    // conditional, so the list's length differs between the two switch states.
    const withSave = iosSheetOptions([CHANGE, SAVE, REMOVE, CANCEL])
    expect(withSave.destructiveButtonIndex).toBe(2)
    expect(withSave.cancelButtonIndex).toBe(3)
  })

  it("keeps the options in the order given", () => {
    expect(iosSheetOptions([CHANGE, SAVE, REMOVE, CANCEL]).options).toEqual([
      "Change quality or subtitles",
      "Save to Photos",
      "Remove all downloads",
      "Cancel",
    ])
  })

  it("omits an index nothing claims, rather than pointing it at row 0", () => {
    const plain = iosSheetOptions([CHANGE, SAVE])
    expect(plain).not.toHaveProperty("destructiveButtonIndex")
    expect(plain).not.toHaveProperty("cancelButtonIndex")
  })
})

describe("androidActions", () => {
  it("passes three or fewer through untouched", () => {
    expect(androidActions([CHANGE, REMOVE, CANCEL])).toEqual([
      CHANGE,
      REMOVE,
      CANCEL,
    ])
  })

  it("drops Cancel rather than letting the dialog drop the destructive row", () => {
    // react-native slices to the first three, which would keep
    // [CHANGE, SAVE, REMOVE] and put the destructive row in the default slot
    // with no Cancel at all. Dropping Cancel ourselves keeps every action the
    // viewer came for; `cancelable` gives the dismiss back.
    const kept = androidActions([CHANGE, SAVE, REMOVE, CANCEL])
    expect(kept).toEqual([CHANGE, SAVE, REMOVE])
    expect(kept).toHaveLength(ANDROID_BUTTON_LIMIT)
    expect(kept.some((a) => a.style === "cancel")).toBe(false)
  })

  it("never returns more than the dialog will draw", () => {
    const many: MenuAction[] = [
      CHANGE,
      SAVE,
      { text: "Another" },
      REMOVE,
      CANCEL,
    ]
    expect(androidActions(many).length).toBeLessThanOrEqual(
      ANDROID_BUTTON_LIMIT,
    )
  })

  it("copies rather than aliasing, so a caller cannot mutate its own menu", () => {
    const source = [CHANGE, REMOVE, CANCEL]
    expect(androidActions(source)).not.toBe(source)
  })
})
