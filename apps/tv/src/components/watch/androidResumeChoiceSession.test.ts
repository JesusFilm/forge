import { openAndroidResumeChoice } from "./androidResumeChoiceSession"

function setup() {
  let resolve!: (choice: string) => void
  let reject!: (error: Error) => void
  const result = new Promise<string>((yes, no) => {
    resolve = yes
    reject = no
  })
  const native = {
    showResumeChoice: jest.fn(() => result),
    dismissResumeChoice: jest.fn(() => Promise.resolve()),
  }
  const callbacks = {
    onResume: jest.fn(),
    onStartOver: jest.fn(),
    onClose: jest.fn(),
  }
  const dispose = openAndroidResumeChoice(
    native,
    "dialog-1",
    "Resume from 0:49",
    callbacks,
  )
  return { native, callbacks, dispose, resolve, reject }
}

it.each(["resume", "start-over", "cancel", "unknown"])(
  "dispatches %s to exactly one callback",
  async (choice) => {
    const { native, callbacks, resolve } = setup()
    expect(native.showResumeChoice).toHaveBeenCalledWith(
      "dialog-1",
      "Resume from 0:49",
    )
    resolve(choice)
    await Promise.resolve()
    expect(callbacks.onResume).toHaveBeenCalledTimes(
      choice === "resume" ? 1 : 0,
    )
    expect(callbacks.onStartOver).toHaveBeenCalledTimes(
      choice === "start-over" ? 1 : 0,
    )
    expect(callbacks.onClose).toHaveBeenCalledTimes(
      choice === "cancel" || choice === "unknown" ? 1 : 0,
    )
  },
)

it("dismisses only its own native request and ignores late results after unmount", async () => {
  const { native, callbacks, dispose, resolve } = setup()
  dispose()
  expect(native.dismissResumeChoice).toHaveBeenCalledWith("dialog-1")
  resolve("resume")
  await Promise.resolve()
  expect(callbacks.onResume).not.toHaveBeenCalled()
  expect(callbacks.onClose).not.toHaveBeenCalled()
})

it("closes safely if the native dialog cannot open", async () => {
  const { callbacks, reject } = setup()
  reject(new Error("Activity unavailable"))
  await Promise.resolve()
  expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  expect(callbacks.onResume).not.toHaveBeenCalled()
})
