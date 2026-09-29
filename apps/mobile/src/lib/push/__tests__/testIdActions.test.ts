/**
 * The reveal's copy action. It must hand the ID to the clipboard and must
 * never throw at the viewer, whether the copy rejects or the native module is
 * missing.
 */

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }))

import * as Clipboard from "expo-clipboard"

import { copyPushTestId } from "../testIdActions"

const setStringAsync = jest.mocked(Clipboard.setStringAsync)

afterEach(() => {
  setStringAsync.mockReset()
})

describe("copyPushTestId", () => {
  it("puts exactly the test ID on the clipboard", () => {
    setStringAsync.mockResolvedValue(true)

    copyPushTestId("k3v9x2m7q4")

    expect(setStringAsync).toHaveBeenCalledTimes(1)
    expect(setStringAsync).toHaveBeenCalledWith("k3v9x2m7q4")
  })

  it("handles a rejected copy in the same tick, so it never goes unhandled", async () => {
    const rejected = Promise.reject(new Error("clipboard unavailable"))
    const handled = jest.spyOn(rejected, "catch")
    setStringAsync.mockReturnValue(rejected)

    expect(() => copyPushTestId("k3v9x2m7q4")).not.toThrow()

    expect(handled).toHaveBeenCalledTimes(1)
    await expect(handled.mock.results[0].value).resolves.toBeUndefined()
  })

  it("swallows a synchronous throw from a missing native module", () => {
    setStringAsync.mockImplementation(() => {
      throw new Error("Cannot find native module 'ExpoClipboard'")
    })

    expect(() => copyPushTestId("k3v9x2m7q4")).not.toThrow()
  })
})
