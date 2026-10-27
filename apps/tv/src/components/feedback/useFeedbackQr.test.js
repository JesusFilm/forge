/* global require, jest, beforeEach, afterEach, test, expect, URL */
/* eslint-disable @typescript-eslint/no-require-imports */
const mockPlatform = { OS: "ios", isTV: true }
const mockNativeSimulator = jest.fn()
const mockAppleAttestation = jest.fn()
const mockAndroidAttestation = jest.fn()
const mockGetItem = jest.fn()
const mockSetItem = jest.fn()
jest.mock("react-native", () => ({ Platform: mockPlatform }))
jest.mock("expo-constants", () => ({
  expoConfig: {
    version: "1.0.0",
    ios: { buildNumber: "15" },
    android: { versionCode: 11 },
  },
}))
jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args) => mockGetItem(...args),
  setItemAsync: (...args) => mockSetItem(...args),
}))
jest.mock("../../../modules/tv-feedback-integrity", () => ({
  isFeedbackSimulatorNative: () => mockNativeSimulator(),
  attestAppleFeedbackGrant: (...args) => mockAppleAttestation(...args),
  attestFeedbackGrant: (...args) => mockAndroidAttestation(...args),
}))
const React = require("react")
const { act, create } = require(
  require.resolve("react-test-renderer", {
    paths: [require.resolve("jest-expo/package.json")],
  }),
)
const { useFeedbackQr } = require("./useFeedbackQr")
const savedEnv = { ...process.env }
const savedFetch = globalThis.fetch
const savedDev = globalThis.__DEV__
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let tree, current, consoleError
function Probe({ enabled = true, screen = "settings" }) {
  current = useFeedbackQr(enabled, { screen })
  return null
}
async function mount(props = {}) {
  await act(async () => {
    tree = create(React.createElement(Probe, props))
  })
}
beforeEach(() => {
  jest.clearAllMocks()
  tree = null
  globalThis.__DEV__ = true
  mockPlatform.OS = "ios"
  mockPlatform.isTV = true
  mockNativeSimulator.mockReturnValue(true)
  mockGetItem.mockResolvedValue(null)
  mockSetItem.mockResolvedValue(undefined)
  process.env.EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED = "true"
  process.env.EXPO_PUBLIC_TV_FEEDBACK_URL = "http://10.1.2.3:3210/tv/local"
  delete process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER
  globalThis.fetch = jest.fn()
  const original = console.error
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((message, ...args) => {
      if (String(message).startsWith("react-test-renderer is deprecated"))
        return
      original(message, ...args)
    })
})
afterEach(async () => {
  if (tree) await act(async () => tree.unmount())
  globalThis.fetch = savedFetch
  globalThis.__DEV__ = savedDev
  for (const name of [
    "EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED",
    "EXPO_PUBLIC_TV_FEEDBACK_URL",
    "EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER",
  ]) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  consoleError.mockRestore()
})

test.each(["ios", "android"])(
  "local %s QR never touches attestation, network or verified cache",
  async (os) => {
    mockPlatform.OS = os
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        feedbackUrl: "https://feedback.example/tv#grant=existing-private-grant",
      }),
    )
    await mount()
    expect(current.mode).toBe("simulator")
    expect(current.verified).toBeNull()
    expect(current.url).toContain("http://10.1.2.3:3210/tv/local?platform=")
    expect(current.qr.modules).toBeGreaterThanOrEqual(21)
    expect(current.error).toBe(false)
    expect(current.loading).toBe(false)
    await act(async () => current.retry())
    await act(async () => {
      tree.update(React.createElement(Probe, { screen: "player" }))
    })
    expect(new URL(current.url).searchParams.get("screen")).toBe("player")
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mockGetItem).not.toHaveBeenCalled()
    expect(mockSetItem).not.toHaveBeenCalled()
    expect(mockAppleAttestation).not.toHaveBeenCalled()
    expect(mockAndroidAttestation).not.toHaveBeenCalled()
  },
)

test.each(["release", "physical", "non-tv", "flag-off"])(
  "local receiver fails closed for %s",
  async (guard) => {
    if (guard === "release") globalThis.__DEV__ = false
    if (guard === "physical") mockNativeSimulator.mockReturnValue(false)
    if (guard === "non-tv") mockPlatform.isTV = false
    if (guard === "flag-off")
      process.env.EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED = "false"
    await mount()
    expect(current.mode).toBe("verified")
    expect(current.url).toBeNull()
    expect(current.qr).toBeNull()
    expect(current.error).toBe(true)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mockGetItem).not.toHaveBeenCalled()
  },
)

test("local mode never falls back to a public server or a cached grant", async () => {
  process.env.EXPO_PUBLIC_TV_FEEDBACK_URL = "https://feedback.example/tv"
  await mount()
  expect(current.mode).toBe("simulator")
  expect(current.url).toBeNull()
  expect(current.error).toBe(true)
  expect(mockGetItem).not.toHaveBeenCalled()
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

test.each(["ios", "android"])(
  "signed %s QR preserves its token without cache, network or attestation",
  async (os) => {
    mockPlatform.OS = os
    const token = `header.payload.${"a".repeat(86)}`
    process.env.EXPO_PUBLIC_TV_FEEDBACK_URL = `https://web-staging-7801.up.railway.app/tv/simulator#token=${token}`
    await mount()
    expect(current.mode).toBe("signed-simulator")
    expect(current.verified).toBeNull()
    expect(new URL(current.url).hash).toBe(`#token=${token}`)
    expect(current.qr.modules).toBeGreaterThanOrEqual(21)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mockGetItem).not.toHaveBeenCalled()
    expect(mockSetItem).not.toHaveBeenCalled()
    expect(mockAppleAttestation).not.toHaveBeenCalled()
    expect(mockAndroidAttestation).not.toHaveBeenCalled()
  },
)

test.each(["release", "physical", "non-tv", "flag-off"])(
  "signed receiver fails closed for %s even with a token",
  async (guard) => {
    process.env.EXPO_PUBLIC_TV_FEEDBACK_URL = `https://web-staging-7801.up.railway.app/tv/simulator#token=header.payload.${"a".repeat(86)}`
    if (guard === "release") globalThis.__DEV__ = false
    if (guard === "physical") mockNativeSimulator.mockReturnValue(false)
    if (guard === "non-tv") mockPlatform.isTV = false
    if (guard === "flag-off")
      process.env.EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED = "false"
    await mount()
    expect(current.url).toBeNull()
    expect(current.qr).toBeNull()
    expect(current.error).toBe(true)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mockGetItem).not.toHaveBeenCalled()
  },
)

test("disabled panel does not create a QR or access storage", async () => {
  await mount({ enabled: false })
  expect(current.url).toBeNull()
  expect(current.loading).toBe(false)
  expect(mockGetItem).not.toHaveBeenCalled()
})

test("normal cached grant still checks status and retains its server identity", async () => {
  delete process.env.EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED
  process.env.EXPO_PUBLIC_TV_FEEDBACK_URL = "https://feedback.example/tv"
  const cached = {
    feedbackUrl: "https://feedback.example/tv#grant=existing-private-grant",
    referenceCode: "WT-TEST",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    serverTime: new Date().toISOString(),
  }
  mockGetItem.mockResolvedValue(JSON.stringify(cached))
  globalThis.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ active: true }),
  })
  await mount({ screen: "search" })
  expect(current.mode).toBe("verified")
  expect(current.verified).toEqual(cached)
  expect(current.url).toContain("screen=search")
  expect(new URL(current.url).hash).toBe("#grant=existing-private-grant")
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "https://feedback.example/api/feedback/tv/status",
    expect.objectContaining({
      body: JSON.stringify({ secret: "existing-private-grant" }),
    }),
  )
  expect(mockSetItem).not.toHaveBeenCalled()
})

test.each(["ios", "android"])(
  "normal %s issuance still requires native proof and stores only a real grant",
  async (os) => {
    mockPlatform.OS = os
    process.env.EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED = "false"
    process.env.EXPO_PUBLIC_TV_FEEDBACK_URL = "https://feedback.example/tv"
    process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER = "123"
    const grant = {
      feedbackUrl: "https://feedback.example/tv#grant=server-grant",
      referenceCode: "WT-SERVER",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      serverTime: new Date().toISOString(),
    }
    mockAppleAttestation.mockResolvedValue({ deviceToken: "test-device-proof" })
    mockAndroidAttestation.mockResolvedValue({
      integrityToken: "test-integrity-proof",
    })
    globalThis.fetch.mockImplementation(async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith("/challenge")
          ? {
              challengeId: "test-challenge",
              nonce: "test-nonce",
              utcDay: "2026-10-21",
            }
          : grant,
    }))
    await mount()
    const proof = os === "ios" ? mockAppleAttestation : mockAndroidAttestation
    expect(proof).toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch.mock.calls[1][0]).toBe(
      `https://feedback.example/api/feedback/tv/${os === "ios" ? "apple-grants" : "grants"}`,
    )
    expect(mockSetItem).toHaveBeenCalledWith(
      "watch-feedback-verified-qr",
      JSON.stringify(grant),
    )
    expect(current.verified).toEqual(grant)
    expect(current.mode).toBe("verified")
  },
)
