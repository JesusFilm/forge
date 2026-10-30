// The two callers outside the root layout read the direction controller through
// this module. A controller that fails to load or to answer must fall back, so
// a start fault never reaches the Startup Error panel.
const mockController = {
  loadThrows: false,
  callThrows: false,
  afterReturnReload: true,
  reloadKind: "return" as "start" | "return" | null,
}

jest.mock("../layoutDirection", () => {
  if (mockController.loadThrows) throw new Error("module evaluation failed")
  const answer =
    <T>(value: () => T) =>
    () => {
      if (mockController.callThrows) throw new Error("no native module")
      return value()
    }
  return {
    afterReturnReload: answer(() => mockController.afterReturnReload),
    directionReloadKind: answer(() => mockController.reloadKind),
  }
})

type Readers = typeof import("../lazyLayoutDirection")

// A fresh registry for each test, so the mock factory runs again on load.
function load(): Readers {
  jest.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../lazyLayoutDirection") as Readers
}

beforeEach(() => {
  mockController.loadThrows = false
  mockController.callThrows = false
  mockController.afterReturnReload = true
  mockController.reloadKind = "return"
})

describe("lazy reads of the direction controller", () => {
  it("passes the controller's answers through", () => {
    const readers = load()
    expect(readers.afterDirectionReturnReload()).toBe(true)
    expect(readers.readDirectionReloadKind()).toBe("return")
  })

  it("falls back when the controller fails to load", () => {
    mockController.loadThrows = true
    const readers = load()
    expect(readers.afterDirectionReturnReload()).toBe(false)
    expect(readers.readDirectionReloadKind()).toBeNull()
  })

  it("falls back when the controller throws", () => {
    mockController.callThrows = true
    const readers = load()
    expect(readers.afterDirectionReturnReload()).toBe(false)
    expect(readers.readDirectionReloadKind()).toBeNull()
  })
})
