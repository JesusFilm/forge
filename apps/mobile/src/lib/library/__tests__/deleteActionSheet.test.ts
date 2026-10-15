// The iOS 26 Downloads delete confirmation (feat-699 U12, KTD8): the native
// action sheet, with the card's Datadog names (R18).
jest.mock("../../datadog", () => ({ reportDatadogAction: jest.fn() }))

import { ActionSheetIOS, type ActionSheetIOSOptions } from "react-native"

import { reportDatadogAction } from "../../datadog"
import { getNonRouteSheetCounter } from "../../miniPlayer/suppression"
import { createDeleteActionSheet } from "../deleteActionSheet"

const MB = 1024 * 1024
const mockedReport = jest.mocked(reportDatadogAction)
const counter = getNonRouteSheetCounter()

type SheetCallback = (buttonIndex: number) => void

let show: jest.SpyInstance
let dismissNative: jest.SpyInstance

beforeEach(() => {
  show = jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation(() => {})
  dismissNative = jest
    .spyOn(ActionSheetIOS, "dismissActionSheet")
    .mockImplementation(() => {})
  mockedReport.mockClear()
})

afterEach(() => {
  jest.restoreAllMocks()
  // Every exit path must release the window; a leak here fails the next case.
  expect(counter.count()).toBe(0)
})

function shownOptions(call = 0): ActionSheetIOSOptions {
  return show.mock.calls[call]![0] as ActionSheetIOSOptions
}

/** The native sheet's answer: 0 is Delete, 1 is Cancel or a tap outside. */
function answer(index: number, call = 0) {
  ;(show.mock.calls[call]![1] as SheetCallback)(index)
}

describe("the native delete sheet", () => {
  it("shows today's title, message and buttons in the dark style (AE4)", () => {
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: ["a", "b"], combinedBytes: 150 * MB }, jest.fn())

    expect(show).toHaveBeenCalledTimes(1)
    expect(shownOptions()).toEqual({
      title: "Delete 2 videos?",
      message:
        "They'll be removed from your downloads and free up 150 MB. You can download them again anytime.",
      options: ["Delete", "Cancel"],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
      userInterfaceStyle: "dark",
    })
    // Opening reports nothing; only an answer does.
    expect(mockedReport).not.toHaveBeenCalled()
    answer(1)
  })

  it("counts as an open sheet that is not inline while it shows", () => {
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: ["a"], combinedBytes: MB }, jest.fn())

    expect(counter.count()).toBe(1)
    expect(counter.inlineCount()).toBe(0)
    answer(1)
  })

  it("deletes the selected slugs on Delete and reports library-delete-confirm once", () => {
    const onDelete = jest.fn()
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: ["a", "b"], combinedBytes: 2 * MB }, onDelete)

    answer(0)

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(["a", "b"])
    expect(mockedReport).toHaveBeenCalledTimes(1)
    expect(mockedReport).toHaveBeenCalledWith("library-delete-confirm")
    expect(counter.count()).toBe(0)
  })

  it("reports library-delete-cancel and deletes nothing on Cancel or a tap outside", () => {
    const onDelete = jest.fn()
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: ["a", "b"], combinedBytes: 2 * MB }, onDelete)

    // iOS sends a tap outside as the cancel button's index.
    answer(1)

    expect(onDelete).not.toHaveBeenCalled()
    expect(mockedReport).toHaveBeenCalledTimes(1)
    expect(mockedReport).toHaveBeenCalledWith("library-delete-cancel")
    expect(counter.count()).toBe(0)
  })

  it("does not show a second sheet while one is open", () => {
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: ["a"], combinedBytes: MB }, jest.fn())
    sheet.present({ slugs: ["a"], combinedBytes: MB }, jest.fn())
    expect(show).toHaveBeenCalledTimes(1)

    // The guard lifts once the sheet closes, so the next Delete opens one.
    answer(1)
    sheet.present({ slugs: ["a"], combinedBytes: MB }, jest.fn())
    expect(show).toHaveBeenCalledTimes(2)
    answer(1, 1)
  })

  it("closes the open sheet when selection ends and ignores its late answer", () => {
    const onDelete = jest.fn()
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: ["a", "b"], combinedBytes: 2 * MB }, onDelete)

    sheet.dismiss()

    expect(dismissNative).toHaveBeenCalledTimes(1)
    expect(counter.count()).toBe(0)
    answer(0)
    answer(1)
    expect(onDelete).not.toHaveBeenCalled()
    expect(mockedReport).not.toHaveBeenCalled()
  })

  it("leaves the native sheets alone when selection ends with no sheet open", () => {
    const sheet = createDeleteActionSheet()
    sheet.dismiss()
    sheet.present({ slugs: ["a"], combinedBytes: MB }, jest.fn())
    answer(1)
    // Selection ends after every answer; that must not close another sheet.
    sheet.dismiss()

    expect(dismissNative).not.toHaveBeenCalled()
  })

  it("deletes the slugs from when the sheet opened, not the current selection", () => {
    const onDelete = jest.fn()
    const selected = new Set(["a", "b"])
    const sheet = createDeleteActionSheet()
    sheet.present({ slugs: selected, combinedBytes: 2 * MB }, onDelete)

    selected.delete("b")
    selected.add("c")
    answer(0)

    expect(onDelete).toHaveBeenCalledWith(["a", "b"])
  })
})
