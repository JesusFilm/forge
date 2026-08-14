/**
 * The one picture-in-picture wiring (U9; R13, R14, R15).
 *
 * The four surfaces that spread these props are pinned by
 * `pictureInPictureCallSites.guard.test.js`; this suite owns what the props
 * mean.
 */

jest.mock("expo-video", () => ({
  isPictureInPictureSupported: jest.fn(() => true),
}))

import { isPictureInPictureSupported } from "expo-video"

import {
  isPictureInPictureAvailable,
  pictureInPictureViewProps,
  resetPictureInPictureSupport,
  startPictureInPicture,
} from "../pictureInPicture"
import {
  isPictureInPictureActive,
  resetPictureInPictureLatch,
} from "../pipLatch"

const supportedMock = isPictureInPictureSupported as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  supportedMock.mockReturnValue(true)
  resetPictureInPictureSupport()
  resetPictureInPictureLatch()
})

afterEach(() => {
  resetPictureInPictureSupport()
  resetPictureInPictureLatch()
})

describe("device support (R15, runtime half)", () => {
  it("reports what the device reports", () => {
    expect(isPictureInPictureAvailable()).toBe(true)

    resetPictureInPictureSupport()
    supportedMock.mockReturnValue(false)

    expect(isPictureInPictureAvailable()).toBe(false)
  })

  it("answers no when the native probe throws", () => {
    supportedMock.mockImplementation(() => {
      throw new Error("no native module")
    })

    expect(isPictureInPictureAvailable()).toBe(false)
  })

  it("asks the device once, not once per render", () => {
    // Every capable surface calls this on every render, at the window's
    // one-second position cadence. Native support cannot change at runtime.
    isPictureInPictureAvailable()
    isPictureInPictureAvailable()
    isPictureInPictureAvailable()

    expect(supportedMock).toHaveBeenCalledTimes(1)
  })
})

describe("the shared view props", () => {
  it("turns the affordance on when the device supports it", () => {
    const props = pictureInPictureViewProps()

    expect(props.allowsPictureInPicture).toBe(true)
    // R14: Android auto-enters on HOME for any eligible view without this;
    // setting it is what makes iOS behave the same way.
    expect(props.startsPictureInPictureAutomatically).toBe(true)
  })

  it("presents NO affordance on a device that cannot honour it", () => {
    supportedMock.mockReturnValue(false)

    const props = pictureInPictureViewProps()

    expect(props.allowsPictureInPicture).toBe(false)
    expect(props.startsPictureInPictureAutomatically).toBe(false)
  })

  it("feeds the latch from the view's start and stop callbacks", () => {
    const props = pictureInPictureViewProps()

    props.onPictureInPictureStart()
    expect(isPictureInPictureActive()).toBe(true)

    props.onPictureInPictureStop()
    expect(isPictureInPictureActive()).toBe(false)
  })

  it("hands every surface the same callback identity", () => {
    // The props object is rebuilt per render. Fresh closures would re-render
    // expo-video's PureComponent view on every tick of the position feed.
    const first = pictureInPictureViewProps()
    const second = pictureInPictureViewProps()

    expect(second.onPictureInPictureStart).toBe(first.onPictureInPictureStart)
    expect(second.onPictureInPictureStop).toBe(first.onPictureInPictureStop)
  })

  it("still feeds the latch on a device with no affordance", () => {
    // The props are inert, not the callbacks: expo-video can put a view into
    // the mode by routes this app does not drive, and a latch that never arms
    // pauses the video the system just handed to the floating window.
    supportedMock.mockReturnValue(false)

    pictureInPictureViewProps().onPictureInPictureStart()

    expect(isPictureInPictureActive()).toBe(true)
  })
})

describe("the manual start wrapper", () => {
  it("enters the mode on a supported device", () => {
    const view = { startPictureInPicture: jest.fn(async () => {}) }

    startPictureInPicture(view)

    expect(view.startPictureInPicture).toHaveBeenCalledTimes(1)
  })

  it("does not call an unsupported device at all", () => {
    supportedMock.mockReturnValue(false)
    const view = { startPictureInPicture: jest.fn(async () => {}) }

    startPictureInPicture(view)

    expect(view.startPictureInPicture).not.toHaveBeenCalled()
  })

  it("survives a view that throws synchronously", () => {
    // expo-video documents this call as throwing on a device that does not
    // support the mode, and the runtime probe does not read the manifest.
    const view = {
      startPictureInPicture: jest.fn(() => {
        throw new Error("Picture in Picture is not supported")
      }),
    }

    expect(() => startPictureInPicture(view as never)).not.toThrow()
  })

  it("attaches a catch to the promise it starts", () => {
    // A thenable rather than a real rejected promise: an unhandled rejection
    // takes the whole jest worker down, so the outcome-shaped version of this
    // case reports a Node crash instead of a failing assertion.
    const attached: string[] = []
    const thenable = {
      catch(handler: (error: unknown) => void) {
        attached.push("catch")
        handler(new Error("nope"))
        return thenable
      },
    }
    const view = { startPictureInPicture: jest.fn(() => thenable) }

    startPictureInPicture(view as never)

    expect(attached).toEqual(["catch"])
  })

  it("does nothing without a view", () => {
    expect(() => startPictureInPicture(null)).not.toThrow()
    expect(() => startPictureInPicture(undefined)).not.toThrow()
  })
})
