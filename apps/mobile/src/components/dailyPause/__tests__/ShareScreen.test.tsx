// The Share step (U11, R7, R20, R22, KTD11, KTD15) in StrictMode, on the REAL
// day record and jest-expo's in-memory file system. Only AsyncStorage, the
// asset system, and the share sheet are modelled.
import AsyncStorage from "@react-native-async-storage/async-storage"
import { File, Paths } from "expo-file-system"
import { StrictMode, act } from "react"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import type { PauseFace } from "../../../lib/dailyPause/fonts"
import {
  PAUSE_DAY_STORAGE_KEY,
  PAUSE_DAY_VERSION,
  resetPauseProgressStoreForTests,
} from "../../../lib/dailyPause/progress"
import type { Today } from "../../../lib/dailyPause/today"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { ShareScreen } from "../ShareScreen"

// No @types/node here; jest runs on Node, so the listener API exists.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void
}

// The stores read the module's `default`, so the mock must carry one.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
}))
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

type MockAsset = { downloadAsync: () => Promise<{ localUri: string | null }> }
const mockFromModule = jest.fn<MockAsset, [number]>()
jest.mock("expo-asset", () => ({
  Asset: { fromModule: (id: number) => mockFromModule(id) },
}))

const mockShareAsync = jest.fn<Promise<void>, [string, object?]>()
jest.mock("expo-sharing", () => ({
  shareAsync: (uri: string, options?: object) => mockShareAsync(uri, options),
}))

const MONDAY_KEY = "2026-10-05"
const PIN: Today = { dayKey: MONDAY_KEY, devotional: DEVOTIONALS.pharisee }
const SHARED_NAME = "Daily Bible Pause – Pharisee.mp4"
const font = (face: PauseFace) => ({ fontFamily: face })

let renderer: TestInstance | null = null

beforeEach(async () => {
  await AsyncStorage.clear()
  resetPauseProgressStoreForTests()
  for (const directory of [Paths.cache, Paths.bundle]) {
    for (const entry of directory.list()) entry.delete()
  }
  const video = new File(Paths.bundle, "pharisee.mp4")
  video.write("the whole pharisee devotional")
  mockFromModule.mockReset()
  mockFromModule.mockImplementation(() => ({
    downloadAsync: async () => ({ localUri: video.uri }),
  }))
  mockShareAsync.mockReset()
  mockShareAsync.mockResolvedValue(undefined)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  jest.useRealTimers()
})

async function render(pin: Today = PIN): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <ShareScreen pin={pin} font={font} />
      </StrictMode>,
    )
  })
  await act(async () => {})
  return renderer!
}

async function tap() {
  await press(pressableByLabel(renderer!, "Share this video"))
  await act(async () => {})
}

/** The labels of every host button, in render order. */
function buttons(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

function screen(): string {
  return JSON.stringify(renderer!.toJSON())
}

/** Every day record that the app saved since the last clear. */
function savedDays(): unknown[] {
  return jest
    .mocked(AsyncStorage.setItem)
    .mock.calls.filter(([key]) => key === PAUSE_DAY_STORAGE_KEY)
    .map(([, value]) => JSON.parse(value) as unknown)
}

it("offers only Share this video under the SHARE prompt (R22)", async () => {
  await render()
  expect(hasText(renderer!, "SHARE")).toBe(true)
  expect(
    hasText(
      renderer!,
      "Before we close, take a moment to consider a couple friends that you could share this truth with.",
    ),
  ).toBe(true)
  expect(buttons()).toEqual(["Share this video"])
})

it("marks the run's pinned day done once when Share appears, after midnight too (R7, KTD11)", async () => {
  // The run began on Monday, and Share appears five minutes into Tuesday.
  jest.useFakeTimers({ now: new Date(2026, 9, 6, 0, 5) })
  await AsyncStorage.setItem(
    PAUSE_DAY_STORAGE_KEY,
    JSON.stringify({
      version: PAUSE_DAY_VERSION,
      dayKey: MONDAY_KEY,
      step: "prayScreen",
      done: false,
      bellRead: true,
    }),
  )
  jest.mocked(AsyncStorage.setItem).mockClear()

  await render()

  expect(savedDays()).toEqual([
    {
      version: PAUSE_DAY_VERSION,
      dayKey: MONDAY_KEY,
      step: "prayScreen",
      done: true,
      bellRead: true,
    },
  ])
})

it("shares today's video once for a second tap while the copy runs", async () => {
  const realCopy = File.prototype.copy
  const heldCopies: (() => void)[] = []
  const copy = jest.spyOn(File.prototype, "copy").mockImplementation(function (
    this: File,
    ...args
  ) {
    const held = new Promise<void>((resolve) => {
      heldCopies.push(resolve)
    })
    return held.then(() => realCopy.apply(this, args))
  })
  try {
    await render()

    await tap()
    await tap()
    expect(mockShareAsync).not.toHaveBeenCalled()

    await act(async () => heldCopies.forEach((finish) => finish()))
    await act(async () => {})

    expect(mockShareAsync).toHaveBeenCalledTimes(1)
    expect(mockShareAsync.mock.calls[0]?.[0]).toBe(
      new File(Paths.cache, SHARED_NAME).uri,
    )
  } finally {
    copy.mockRestore()
  }
})

it("stays on Share with no error after a cancel, and shares again on the next tap", async () => {
  // The sheet resolves the same way for a share and for a cancel.
  await render()
  const before = screen()

  await tap()

  expect(mockShareAsync).toHaveBeenCalledTimes(1)
  expect(screen()).toBe(before)
  expect(buttons()).toEqual(["Share this video"])

  await tap()
  expect(mockShareAsync).toHaveBeenCalledTimes(2)
})

it("stays on Share after a failed share, raises nothing, and shares again on the next tap", async () => {
  mockShareAsync.mockRejectedValueOnce(new Error("sheet failed"))
  const unhandled = jest.fn()
  process.on("unhandledRejection", unhandled)
  try {
    await render()
    const before = screen()

    await tap()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockShareAsync).toHaveBeenCalledTimes(1)
    expect(unhandled).not.toHaveBeenCalled()
    expect(screen()).toBe(before)
    expect(buttons()).toEqual(["Share this video"])

    await tap()
    expect(mockShareAsync).toHaveBeenCalledTimes(2)
  } finally {
    process.off("unhandledRejection", unhandled)
  }
})

// Review #5: a video that could not be loaded left a Share button that did
// nothing, with no message.
it("offers Try again when the video cannot be loaded, and then shares it", async () => {
  const video = new File(Paths.bundle, "pharisee.mp4")
  let failing = true
  mockFromModule.mockImplementation(() => ({
    downloadAsync: () =>
      failing
        ? Promise.reject(new Error("no asset"))
        : Promise.resolve({ localUri: video.uri }),
  }))
  await render()
  expect(buttons()).toEqual(["Try again"])
  expect(hasText(renderer!, "This video could not be loaded.")).toBe(true)

  failing = false
  await press(pressableByLabel(renderer!, "Try again"))
  await act(async () => {})
  expect(buttons()).toEqual(["Share this video"])
  await tap()
  expect(mockShareAsync).toHaveBeenCalledTimes(1)
})
