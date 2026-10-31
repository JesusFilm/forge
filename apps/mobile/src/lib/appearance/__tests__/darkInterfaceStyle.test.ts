/* eslint-disable @typescript-eslint/no-require-imports */
type ReactNative = typeof import("react-native")
type Entry = typeof import("../darkInterfaceStyle")
type AppStateHandler = (state: string) => void

let setColorScheme: jest.SpyInstance
let handlers: AppStateHandler[]
let addEventListener: jest.SpyInstance

// A fresh registry per test, because the entry keeps its listener for the
// whole runtime. The entry loads React Native lazily, so the spies go on the
// copy in the same registry.
function load(os: "ios" | "android"): Entry {
  jest.resetModules()
  const rn = require("react-native") as ReactNative
  Object.defineProperty(rn.Platform, "OS", { value: os, configurable: true })
  setColorScheme = jest
    .spyOn(rn.Appearance, "setColorScheme")
    .mockImplementation(() => {})
  addEventListener = jest
    .spyOn(rn.AppState, "addEventListener")
    .mockImplementation((_event, handler) => {
      handlers.push(handler as AppStateHandler)
      return { remove: () => {} } as ReturnType<
        ReactNative["AppState"]["addEventListener"]
      >
    })
  return require("../darkInterfaceStyle") as Entry
}

beforeEach(() => {
  handlers = []
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("applyDarkInterfaceStyle", () => {
  it("sets the dark style on iOS", () => {
    load("ios").applyDarkInterfaceStyle()
    expect(setColorScheme).toHaveBeenCalledTimes(1)
    expect(setColorScheme).toHaveBeenCalledWith("dark")
  })

  it("does nothing on Android", () => {
    load("android").applyDarkInterfaceStyle()
    expect(setColorScheme).not.toHaveBeenCalled()
    expect(addEventListener).not.toHaveBeenCalled()
  })

  it("sets the dark style again each time the app becomes active", () => {
    load("ios").applyDarkInterfaceStyle()
    expect(addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    )
    setColorScheme.mockClear()

    for (const handler of handlers) handler("active")
    expect(setColorScheme).toHaveBeenCalledTimes(1)
    expect(setColorScheme).toHaveBeenCalledWith("dark")
  })

  it("does not set the style for background or inactive", () => {
    load("ios").applyDarkInterfaceStyle()
    setColorScheme.mockClear()

    for (const handler of handlers) {
      handler("background")
      handler("inactive")
    }
    expect(setColorScheme).not.toHaveBeenCalled()
  })

  it("adds one AppState listener when it is called twice", () => {
    const entry = load("ios")
    entry.applyDarkInterfaceStyle()
    entry.applyDarkInterfaceStyle()
    expect(addEventListener).toHaveBeenCalledTimes(1)
    expect(setColorScheme).toHaveBeenCalledTimes(2)

    setColorScheme.mockClear()
    for (const handler of handlers) handler("active")
    expect(setColorScheme).toHaveBeenCalledTimes(1)
  })
})
