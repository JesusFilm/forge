/**
 * The one Liquid Glass gate (KTD1). Each case loads a fresh copy of the module,
 * because the predicate keeps its first answer for the rest of the launch.
 */
import { Platform } from "react-native"

// The `mock` prefix lets the hoisted factory read this object. The factory
// runs again in each isolated registry, so the state must live out here.
const mockGlass = { liquid: true, api: true, liquidCalls: 0, apiCalls: 0 }
jest.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => {
    mockGlass.liquidCalls += 1
    return mockGlass.liquid
  },
  isGlassEffectAPIAvailable: () => {
    mockGlass.apiCalls += 1
    return mockGlass.api
  },
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
})

beforeEach(() => {
  mockGlass.liquid = true
  mockGlass.api = true
  mockGlass.liquidCalls = 0
  mockGlass.apiCalls = 0
})

function loadPredicate(os: "ios" | "android"): () => boolean {
  // React Native's index reads `Platform` when the predicate runs, after the
  // isolation ends, so it gets this registry's copy.
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
  let predicate!: () => boolean
  jest.isolateModules(() => {
    predicate =
      jest.requireActual<typeof import("../liquidGlass")>(
        "../liquidGlass",
      ).canUseLiquidGlass
  })
  return predicate
}

describe("canUseLiquidGlass", () => {
  it("is true on iOS when the design and the API are both available", () => {
    expect(loadPredicate("ios")()).toBe(true)
  })

  it("is false on iOS when the design is not available (iOS before 26)", () => {
    mockGlass.liquid = false
    expect(loadPredicate("ios")()).toBe(false)
  })

  it("is false on iOS when the API is missing (iOS 26 betas that crash)", () => {
    mockGlass.api = false
    expect(loadPredicate("ios")()).toBe(false)
  })

  it("is false on Android and does not call the native functions", () => {
    expect(loadPredicate("android")()).toBe(false)
    expect(mockGlass.liquidCalls).toBe(0)
    expect(mockGlass.apiCalls).toBe(0)
  })

  it("keeps its first answer for the launch, so a tab role cannot flip", () => {
    const predicate = loadPredicate("ios")
    expect(predicate()).toBe(true)

    mockGlass.liquid = false
    mockGlass.api = false
    expect(predicate()).toBe(true)
    expect(mockGlass.liquidCalls).toBe(1)
    expect(mockGlass.apiCalls).toBe(1)
  })
})
