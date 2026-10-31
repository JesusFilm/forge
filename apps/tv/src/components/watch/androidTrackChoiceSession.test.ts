import {
  openAndroidTrackChoice,
  type AndroidTrackChoiceModule,
} from "./androidTrackChoiceSession"

type Choice = { id: string; query: string } | null

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function setup(select?: (id: string) => void | false) {
  const requests: ReturnType<typeof deferred<Choice>>[] = []
  const native: jest.Mocked<AndroidTrackChoiceModule> = {
    showTrackChoice: jest.fn<
      ReturnType<AndroidTrackChoiceModule["showTrackChoice"]>,
      Parameters<AndroidTrackChoiceModule["showTrackChoice"]>
    >(() => {
      const request = deferred<Choice>()
      requests.push(request)
      return request.promise
    }),
    updateTrackChoice: jest.fn<
      ReturnType<AndroidTrackChoiceModule["updateTrackChoice"]>,
      Parameters<AndroidTrackChoiceModule["updateTrackChoice"]>
    >(async () => {}),
    dismissTrackChoice: jest.fn<
      ReturnType<AndroidTrackChoiceModule["dismissTrackChoice"]>,
      Parameters<AndroidTrackChoiceModule["dismissTrackChoice"]>
    >(async () => {}),
  }
  const onSelect = jest.fn((id: string) => select?.(id))
  const onClose = jest.fn()
  const session = openAndroidTrackChoice(
    native,
    "picker",
    "Audio Language",
    [{ id: "en", label: "English" }],
    "en",
    null,
    onSelect,
    onClose,
  )
  return { native, onSelect, onClose, session, requests }
}

it("returns stable option identity rather than a sorted index", async () => {
  const test = setup()
  test.requests[0].resolve({ id: "en", query: "English" })
  await Promise.resolve()
  expect(test.onSelect).toHaveBeenCalledWith("en")
  expect(test.onClose).not.toHaveBeenCalled()
  expect(test.native.showTrackChoice).toHaveBeenCalledTimes(1)
})

it("handles Back cancellation once and ignores later updates", async () => {
  const test = setup()
  test.requests[0].resolve(null)
  await Promise.resolve()
  test.session.update([], null, "Loading languages…")
  expect(test.onClose).toHaveBeenCalledTimes(1)
  expect(test.onSelect).not.toHaveBeenCalled()
  expect(test.native.updateTrackChoice).not.toHaveBeenCalled()
})

it("ignores stale results after unmount and dismisses only its request once", async () => {
  const test = setup()
  test.session.dispose()
  test.session.dispose()
  test.requests[0].resolve({ id: "en", query: "en" })
  await Promise.resolve()
  expect(test.native.dismissTrackChoice).toHaveBeenCalledTimes(1)
  expect(test.native.dismissTrackChoice).toHaveBeenCalledWith("picker-0")
  expect(test.onSelect).not.toHaveBeenCalled()
  expect(test.onClose).not.toHaveBeenCalled()
})

it("closes safely when native presentation fails", async () => {
  const test = setup()
  test.requests[0].reject(new Error("No activity"))
  await Promise.resolve()
  expect(test.onClose).toHaveBeenCalledTimes(1)
  expect(test.native.dismissTrackChoice).toHaveBeenCalledWith("picker-0")
})

it("does not close another panel when a dismissed request rejects later", async () => {
  const test = setup()
  test.session.dispose()
  test.requests[0].reject(new Error("Activity destroyed"))
  await Promise.resolve()
  expect(test.onClose).not.toHaveBeenCalled()
})

it("updates an open dialog without reopening or clearing its search", () => {
  const test = setup()
  const options = [{ id: "th", label: "Thai", searchText: "th ไทย" }]
  test.session.update(options, "th", "Loading languages…")
  expect(test.native.updateTrackChoice).toHaveBeenCalledWith(
    "picker-0",
    options,
    "th",
    "Loading languages…",
  )
  expect(test.native.showTrackChoice).toHaveBeenCalledTimes(1)
})

it("retry presents a new request with the exact search and latest data", async () => {
  const test = setup((id) => (id === "__retry__" ? false : undefined))
  const retryOptions = [{ id: "__retry__", label: "Try again", pinned: true }]
  test.session.update(retryOptions, null, "Couldn’t load languages")
  test.requests[0].resolve({ id: "__retry__", query: " ไทย " })
  await Promise.resolve()
  expect(test.onSelect).toHaveBeenCalledWith("__retry__")
  expect(test.onClose).not.toHaveBeenCalled()
  expect(test.native.showTrackChoice).toHaveBeenNthCalledWith(
    2,
    "picker-1",
    "Audio Language",
    retryOptions,
    null,
    "Couldn’t load languages",
    " ไทย ",
  )

  const ready = [{ id: "th", label: "Thai" }]
  test.session.update(ready, "th", null)
  expect(test.native.updateTrackChoice).toHaveBeenLastCalledWith(
    "picker-1",
    ready,
    "th",
    null,
  )
  test.requests[1].resolve({ id: "th", query: " ไทย " })
  await Promise.resolve()
  expect(test.onSelect).toHaveBeenLastCalledWith("th")
  expect(test.native.showTrackChoice).toHaveBeenCalledTimes(2)
})

it("disposes the retry request and suppresses its late choice", async () => {
  const test = setup(() => false)
  test.requests[0].resolve({ id: "__retry__", query: "English" })
  await Promise.resolve()
  test.session.dispose()
  test.requests[1].resolve({ id: "en", query: "English" })
  await Promise.resolve()
  expect(test.native.dismissTrackChoice).toHaveBeenCalledWith("picker-1")
  expect(test.onSelect).toHaveBeenCalledTimes(1)
  expect(test.onClose).not.toHaveBeenCalled()
})

it("a failed update closes the current request rather than leaving stale rows", async () => {
  const test = setup()
  test.native.updateTrackChoice.mockRejectedValueOnce(
    new Error("Bridge closed"),
  )
  test.session.update([], null, "Loading languages…")
  await Promise.resolve()
  expect(test.onClose).toHaveBeenCalledTimes(1)
  expect(test.native.dismissTrackChoice).toHaveBeenCalledWith("picker-0")
})

it("a late failed update from before retry cannot close the new request", async () => {
  const test = setup(() => false)
  const update = deferred<void>()
  test.native.updateTrackChoice.mockReturnValueOnce(update.promise)
  test.session.update([], null, "Couldn’t load languages")
  test.requests[0].resolve({ id: "__retry__", query: "en" })
  await Promise.resolve()
  update.reject(new Error("Old update rejected"))
  await Promise.resolve()
  expect(test.onClose).not.toHaveBeenCalled()
  expect(test.native.dismissTrackChoice).not.toHaveBeenCalled()
})
