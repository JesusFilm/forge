import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const AUTH_KEYS = ["CHAT_BASE_URL", "NODE_ENV"] as const

function clearEnv() {
  for (const key of AUTH_KEYS) delete process.env[key]
}

async function importOrigins() {
  vi.resetModules()
  return import("./origins")
}

beforeEach(() => {
  clearEnv()
  process.env.CHAT_BASE_URL = "https://chat.jesusfilm.org"
})
afterEach(clearEnv)

describe("resolveChatReturnToURL (R10)", () => {
  it("returns a return_to on chat's own origin unchanged", async () => {
    const { resolveChatReturnToURL } = await importOrigins()
    expect(resolveChatReturnToURL("https://chat.jesusfilm.org/thread/42")).toBe(
      "https://chat.jesusfilm.org/thread/42",
    )
  })

  it("falls back to chat home for a cross-origin return_to (AE4/R10)", async () => {
    const { resolveChatReturnToURL, getChatHomeURL } = await importOrigins()
    expect(resolveChatReturnToURL("https://evil.example.com/steal")).toBe(
      getChatHomeURL(),
    )
  })

  it("resolves a relative path against chat's origin (same-origin → kept)", async () => {
    const { resolveChatReturnToURL } = await importOrigins()
    expect(resolveChatReturnToURL("/thread/7")).toBe(
      "https://chat.jesusfilm.org/thread/7",
    )
  })

  it("never yields a foreign origin — an odd string resolves as a same-origin path", async () => {
    // With a base, most malformed refs resolve relative to chat's own origin
    // rather than throwing; that is still same-origin, so it is safe to keep.
    const { resolveChatReturnToURL } = await importOrigins()
    const result = resolveChatReturnToURL("ht!tp://%%%")
    expect(new URL(result).origin).toBe("https://chat.jesusfilm.org")
  })

  it("falls back to chat home for a return_to that fails to parse even against the base", async () => {
    const { resolveChatReturnToURL, getChatHomeURL } = await importOrigins()
    // A bare non-special scheme with no authority throws in new URL(_, base).
    expect(resolveChatReturnToURL("http://")).toBe(getChatHomeURL())
  })

  it("returns the fallback when return_to is undefined", async () => {
    const { resolveChatReturnToURL, getChatHomeURL } = await importOrigins()
    expect(resolveChatReturnToURL(undefined)).toBe(getChatHomeURL())
  })

  it("rejects a scheme-relative //host that resolves to a foreign origin", async () => {
    const { resolveChatReturnToURL, getChatHomeURL } = await importOrigins()
    expect(resolveChatReturnToURL("//evil.example.com/x")).toBe(
      getChatHomeURL(),
    )
  })
})

describe("getChatBaseURL", () => {
  it("uses CHAT_BASE_URL when set", async () => {
    process.env.CHAT_BASE_URL = "https://chat.example.org"
    const { getChatBaseURL } = await importOrigins()
    expect(getChatBaseURL()).toBe("https://chat.example.org")
  })

  it("defaults to localhost off-prod when unset", async () => {
    delete process.env.CHAT_BASE_URL
    const { getChatBaseURL } = await importOrigins()
    expect(getChatBaseURL()).toBe("http://localhost:3200")
  })

  it("falls through to the default when CHAT_BASE_URL is malformed (never throws)", async () => {
    process.env.CHAT_BASE_URL = "chat.jesusfilm.org" // scheme-less
    const { getChatBaseURL, getChatHomeURL } = await importOrigins()
    expect(getChatBaseURL()).toBe("http://localhost:3200")
    // The load-bearing property: this must NOT throw (would 500 auth routes).
    expect(() => getChatHomeURL()).not.toThrow()
    expect(getChatHomeURL()).toBe("http://localhost:3200/")
  })
})
