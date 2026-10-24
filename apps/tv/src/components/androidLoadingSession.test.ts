import { openAndroidLoading } from "./androidLoadingSession"

function setup() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const result = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const native = {
    showLoadingDialog: jest.fn(() => result),
    dismissLoadingDialog: jest.fn(() => Promise.resolve()),
  }
  const onBack = jest.fn()
  const dispose = openAndroidLoading(
    native,
    "loading-1",
    "Loading movie details…",
    onBack,
  )
  return { native, onBack, dispose, resolve, reject }
}

it("shows a labeled native loading dialog and dispatches Back once", async () => {
  const { native, onBack, resolve } = setup()
  expect(native.showLoadingDialog).toHaveBeenCalledWith(
    "loading-1",
    "Loading movie details…",
  )
  resolve()
  await Promise.resolve()
  expect(onBack).toHaveBeenCalledTimes(1)
})

it("dismisses on completion without treating normal cleanup as a Back press", async () => {
  const { native, onBack, dispose, resolve } = setup()
  dispose()
  expect(native.dismissLoadingDialog).toHaveBeenCalledWith("loading-1")
  resolve()
  await Promise.resolve()
  expect(onBack).not.toHaveBeenCalled()
})

it("ignores late errors after navigation away", async () => {
  const { onBack, dispose, reject } = setup()
  dispose()
  reject(new Error("Activity closed"))
  await Promise.resolve()
  expect(onBack).not.toHaveBeenCalled()
})

it("does not leave a dead loading screen when the native dialog cannot open", async () => {
  const { onBack, reject } = setup()
  reject(new Error("Activity unavailable"))
  await Promise.resolve()
  expect(onBack).toHaveBeenCalledTimes(1)
})
