/**
 * The reader's read of the phone setting (feat-699 KTD4). The subscription
 * is torn down in cleanup, so every case renders under StrictMode.
 */
import { StrictMode, act } from "react"
import { Platform } from "react-native"

import type {
  PhoneColorScheme,
  SystemAppearanceModule,
} from "../../../modules/system-appearance"
import { resolveReaderTheme } from "../../lib/bible/theme/palettes"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { usePhoneColorScheme } from "../usePhoneColorScheme"

const mockAppearance: { current: SystemAppearanceModule | null } = {
  current: null,
}
jest.mock("../../../modules/system-appearance", () => ({
  getSystemAppearanceModule: () => mockAppearance.current,
}))
// React Native's own hook. On iOS it says "dark" after the window override.
const mockReactNative: { scheme: string | null } = { scheme: "dark" }
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockReactNative.scheme,
}))

/** A module double: a cached scheme and its change listeners. */
function fakeModule(initial: PhoneColorScheme) {
  let scheme = initial
  const listeners = new Set<(next: PhoneColorScheme) => void>()
  const module: SystemAppearanceModule = {
    available: true,
    getPhoneColorScheme: () => scheme,
    addChangeListener(listener) {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
  }
  return {
    module,
    listenerCount: () => listeners.size,
    change(next: PhoneColorScheme) {
      scheme = next
      for (const listener of listeners) listener(next)
    },
  }
}

const platformOs = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

const seen: PhoneColorScheme[] = []

function Probe() {
  seen.push(usePhoneColorScheme())
  return null
}

const latest = () => seen[seen.length - 1]

async function render(): Promise<TestInstance> {
  let renderer: TestInstance | undefined
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
  return renderer!
}

beforeEach(() => {
  seen.length = 0
  mockReactNative.scheme = "dark"
  setPlatform("ios")
})

afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOs)
  jest.restoreAllMocks()
})

describe("usePhoneColorScheme on iOS", () => {
  it("returns the module's setting, not React Native's dark override", async () => {
    mockAppearance.current = fakeModule("light").module
    await render()
    expect(latest()).toBe("light")
  })

  it("re-renders with the new setting on a change event", async () => {
    const fake = fakeModule("light")
    mockAppearance.current = fake.module
    await render()
    expect(latest()).toBe("light")

    await act(async () => fake.change("dark"))
    expect(latest()).toBe("dark")
  })

  it("stops listening when it unmounts", async () => {
    const fake = fakeModule("light")
    mockAppearance.current = fake.module
    const renderer = await render()
    expect(fake.listenerCount()).toBe(1)

    await act(async () => renderer.unmount())
    expect(fake.listenerCount()).toBe(0)
  })

  it("returns null with the inert module, so System mode resolves to Dark", async () => {
    // The real loader: Jest has no SystemAppearance native module.
    const real = jest.requireActual<
      typeof import("../../../modules/system-appearance")
    >("../../../modules/system-appearance")
    mockAppearance.current = real.getSystemAppearanceModule()
    expect(mockAppearance.current.available).toBe(false)
    await render()
    expect(latest()).toBeNull()
    expect(resolveReaderTheme("system", latest())).toBe("dark")
  })
})

describe("usePhoneColorScheme on Android", () => {
  it.each(["light", "dark"] as const)(
    "returns React Native's %s setting",
    async (scheme) => {
      setPlatform("android")
      mockReactNative.scheme = scheme
      mockAppearance.current = fakeModule(
        scheme === "light" ? "dark" : "light",
      ).module
      await render()
      expect(latest()).toBe(scheme)
    },
  )

  it("returns null when React Native has no setting", async () => {
    setPlatform("android")
    mockReactNative.scheme = null
    mockAppearance.current = fakeModule("light").module
    await render()
    expect(latest()).toBeNull()
  })
})
