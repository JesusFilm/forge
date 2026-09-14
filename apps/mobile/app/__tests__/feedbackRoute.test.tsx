/**
 * The Profile door's route (U5): it opens the sheet on step one, and it refuses
 * every dismissal it can reach while a submission is in flight (R19).
 *
 * The sheet body is stubbed so the route's OWN wiring is what is measured: the
 * context it passes, and what it does with `onDismissLockedChange`.
 */

// A `const` captured by a factory would be in its temporal dead zone: babel
// hoists these calls above the imports, so a factory runs before the module
// body assigns it. Both stubs read their state through exported getters.
jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
  useNavigation: jest.fn(),
}))
jest.mock("../../src/components/feedback/FeedbackSheetContent", () => ({
  FeedbackSheetContent: jest.fn(() => null),
}))

import { act } from "react"
import { useNavigation, useRouter } from "expo-router"

import FeedbackSheetRoute from "../feedback"
import { FeedbackSheetContent } from "../../src/components/feedback/FeedbackSheetContent"
import {
  TestRenderer,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

type BeforeRemoveListener = (event: { preventDefault: () => void }) => void

const back = jest.fn()
const setOptions = jest.fn()
const removeListener = jest.fn()
let beforeRemoveListeners: BeforeRemoveListener[] = []

const addListener = jest.fn((event: string, listener: BeforeRemoveListener) => {
  expect(event).toBe("beforeRemove")
  beforeRemoveListeners.push(listener)
  return removeListener
})

const mockedContent = jest.mocked(FeedbackSheetContent)

/** The latest props the route handed the sheet body. */
function sheetProps() {
  const calls = mockedContent.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<FeedbackSheetRoute />)
  })
  return renderer
}

/** Drives the seam U4 owns: the body reports its own in-flight state. */
async function setDismissLocked(locked: boolean) {
  await act(async () => {
    sheetProps().onDismissLockedChange?.(locked)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  beforeRemoveListeners = []
  jest
    .mocked(useRouter)
    .mockReturnValue({ back } as unknown as ReturnType<typeof useRouter>)
  jest.mocked(useNavigation).mockReturnValue({
    setOptions,
    addListener,
  } as unknown as ReturnType<typeof useNavigation>)
})

describe("the feedback route", () => {
  it("renders the sheet body with no context, so it opens on step one", async () => {
    await render()
    expect(sheetProps().context).toBeUndefined()
  })

  it("pops the route when the body asks to close", async () => {
    await render()
    await act(async () => {
      sheetProps().onClose()
    })
    expect(back).toHaveBeenCalledTimes(1)
  })

  it("leaves the sheet dismissible while nothing is in flight", async () => {
    await render()
    expect(setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true })
    expect(addListener).not.toHaveBeenCalled()
  })

  it("refuses the iOS pull-down and the Android back while sending", async () => {
    await render()
    await setDismissLocked(true)

    expect(setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false })
    expect(beforeRemoveListeners).toHaveLength(1)

    const preventDefault = jest.fn()
    beforeRemoveListeners[0]({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it("restores both when the submission settles", async () => {
    await render()
    await setDismissLocked(true)
    await setDismissLocked(false)

    expect(setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true })
    expect(removeListener).toHaveBeenCalledTimes(1)
  })

  it("drops the listener when the route unmounts mid-send", async () => {
    const renderer = await render()
    await setDismissLocked(true)
    await act(async () => {
      renderer.unmount()
    })
    expect(removeListener).toHaveBeenCalledTimes(1)
  })
})
