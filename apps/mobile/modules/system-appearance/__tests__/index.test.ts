// The mock stands in for the native lookup; each test sets what it returns.
const mockNative: { current: unknown; throws: boolean } = {
  current: null,
  throws: false,
}
jest.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) => {
    if (mockNative.throws) throw new Error("no expo")
    return name === "SystemAppearance" ? mockNative.current : null
  },
}))

type Entry = typeof import("../index")
type ChangeEvent = { colorScheme?: unknown }

function loadEntry(): Entry {
  let entry: Entry | undefined
  // A fresh registry per test, because the entry caches its lookup.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    entry = require("../index") as Entry
  })
  return entry!
}

/** A native double with a cached scheme and the Expo event emitter shape. */
function fakeNative(initial: unknown) {
  let scheme = initial
  const listeners = new Map<string, Set<(event: ChangeEvent) => void>>()
  return {
    getColorScheme: () => scheme,
    addListener(event: string, listener: (event: ChangeEvent) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return { remove: () => set.delete(listener) }
    },
    /** Updates the cache first, as the Swift store does, then emits. */
    change(next: unknown) {
      scheme = next
      for (const listener of listeners.get("onChange") ?? []) {
        listener({ colorScheme: next })
      }
    },
  }
}

beforeEach(() => {
  mockNative.current = null
  mockNative.throws = false
})

describe("getSystemAppearanceModule", () => {
  it.each([
    ["missing", () => {}],
    ["unloadable", () => (mockNative.throws = true)],
  ])("returns an inert module when the native module is %s", (_, arrange) => {
    arrange()
    const appearance = loadEntry().getSystemAppearanceModule()
    expect(appearance.available).toBe(false)
    expect(appearance.getPhoneColorScheme()).toBeNull()
    const listener = jest.fn()
    const subscription = appearance.addChangeListener(listener)
    expect(() => subscription.remove()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it.each(["light", "dark"] as const)(
    "reads the native %s setting",
    (scheme) => {
      mockNative.current = fakeNative(scheme)
      const appearance = loadEntry().getSystemAppearanceModule()
      expect(appearance.available).toBe(true)
      expect(appearance.getPhoneColorScheme()).toBe(scheme)
    },
  )

  it.each([null, undefined, "unspecified", 2])(
    "reads the native value %p as no setting",
    (value) => {
      mockNative.current = fakeNative(value)
      expect(
        loadEntry().getSystemAppearanceModule().getPhoneColorScheme(),
      ).toBeNull()
    },
  )

  it("passes each change event to the listener until it is removed", () => {
    const native = fakeNative("light")
    mockNative.current = native
    const appearance = loadEntry().getSystemAppearanceModule()
    const listener = jest.fn()
    const subscription = appearance.addChangeListener(listener)

    native.change("dark")
    expect(listener).toHaveBeenLastCalledWith("dark")
    expect(appearance.getPhoneColorScheme()).toBe("dark")
    native.change("unspecified")
    expect(listener).toHaveBeenLastCalledWith(null)

    subscription.remove()
    native.change("light")
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
