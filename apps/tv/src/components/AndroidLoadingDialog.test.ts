import { requireNativeModule } from "expo"
import { useFocusEffect } from "expo-router"
import { useStartupIntroActive } from "../contexts/StartupIntroProvider"
import { AndroidLoadingDialog } from "./AndroidLoadingDialog"

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useCallback: (callback: () => unknown) => callback,
  useId: () => "route",
  useRef: (current: unknown) => ({ current }),
}))
jest.mock("expo", () => ({ requireNativeModule: jest.fn() }))
jest.mock("expo-router", () => ({ useFocusEffect: jest.fn() }))
jest.mock("../contexts/StartupIntroProvider", () => ({
  useStartupIntroActive: jest.fn(() => false),
}))

function focusRoute(introActive: boolean) {
  jest.clearAllMocks()
  jest.mocked(useStartupIntroActive).mockReturnValue(introActive)
  let resolve!: () => void
  const pending = new Promise<void>((done) => {
    resolve = done
  })
  const native = {
    showLoadingDialog: jest.fn(() => pending),
    dismissLoadingDialog: jest.fn(() => Promise.resolve()),
  }
  jest.mocked(requireNativeModule).mockReturnValue(native)
  const onBack = jest.fn()
  AndroidLoadingDialog({ message: "Loading Home…", onBack })
  const cleanup = jest.mocked(useFocusEffect).mock.calls[0][0]()
  return { native, onBack, cleanup, resolve }
}

test("the active intro keeps ownership of Select and Back", () => {
  const { native, cleanup } = focusRoute(true)
  expect(cleanup).toBeUndefined()
  expect(requireNativeModule).not.toHaveBeenCalled()
  expect(native.showLoadingDialog).not.toHaveBeenCalled()
})

test("pending work opens a labeled shield after the intro finishes", () => {
  const { native, cleanup } = focusRoute(false)
  expect(native.showLoadingDialog).toHaveBeenCalledWith(
    "route-1",
    "Loading Home…",
  )
  expect(typeof cleanup).toBe("function")
})

test("ready cleanup closes the shield without navigating back", async () => {
  const { native, onBack, cleanup, resolve } = focusRoute(false)
  if (typeof cleanup === "function") cleanup()
  expect(native.dismissLoadingDialog).toHaveBeenCalledWith("route-1")
  resolve()
  await Promise.resolve()
  expect(onBack).not.toHaveBeenCalled()
})

test("remote cancellation while loading goes back once", async () => {
  const { onBack, resolve } = focusRoute(false)
  resolve()
  await Promise.resolve()
  expect(onBack).toHaveBeenCalledTimes(1)
})
