import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// env.ts parses process.env at module load, so each case sets process.env then
// re-imports a fresh module copy (vi.resetModules) — the same shape mastra's
// env tests use.
const SEEKER_KEYS = [
  "SEEKER_CHAT_ENABLED",
  "SEEKER_MASTRA_BASE_URL",
  "SEEKER_MASTRA_API_KEY",
  "SEEKER_MASTRA_ALLOWED_HOSTS",
  "SEEKER_TIMEOUT_MS",
] as const

function clearSeekerEnv() {
  for (const key of SEEKER_KEYS) delete process.env[key]
}

async function importEnv() {
  vi.resetModules()
  return import("./env")
}

beforeEach(clearSeekerEnv)
afterEach(clearSeekerEnv)

describe("isSeekerChatEnabled", () => {
  it("is true only for the literal 'true'", async () => {
    process.env.SEEKER_CHAT_ENABLED = "true"
    const { isSeekerChatEnabled } = await importEnv()
    expect(isSeekerChatEnabled()).toBe(true)
  })

  it.each(["", "false", "1", "TRUE", "yes"])(
    "is false for %j",
    async (value) => {
      process.env.SEEKER_CHAT_ENABLED = value
      const { isSeekerChatEnabled } = await importEnv()
      expect(isSeekerChatEnabled()).toBe(false)
    },
  )

  it("is false when unset", async () => {
    const { isSeekerChatEnabled } = await importEnv()
    expect(isSeekerChatEnabled()).toBe(false)
  })
})

describe("env parsing", () => {
  it("does not throw when no Seeker env vars are set (default-off boot)", async () => {
    await expect(importEnv()).resolves.toBeDefined()
    const { env } = await importEnv()
    expect(env.SEEKER_MASTRA_BASE_URL).toBeUndefined()
    expect(env.SEEKER_MASTRA_API_KEY).toBeUndefined()
  })

  it("normalizes empty-string vars to undefined", async () => {
    process.env.SEEKER_MASTRA_BASE_URL = ""
    process.env.SEEKER_MASTRA_API_KEY = ""
    const { env } = await importEnv()
    expect(env.SEEKER_MASTRA_BASE_URL).toBeUndefined()
    expect(env.SEEKER_MASTRA_API_KEY).toBeUndefined()
  })
})

describe("seekerTimeoutMs", () => {
  it("parses a positive numeric string", async () => {
    process.env.SEEKER_TIMEOUT_MS = "120000"
    const { seekerTimeoutMs } = await importEnv()
    expect(seekerTimeoutMs()).toBe(120000)
  })

  it("falls back to 95000 when unset", async () => {
    const { seekerTimeoutMs } = await importEnv()
    expect(seekerTimeoutMs()).toBe(95000)
  })

  it("falls back to 95000 when blank", async () => {
    process.env.SEEKER_TIMEOUT_MS = ""
    const { seekerTimeoutMs } = await importEnv()
    expect(seekerTimeoutMs()).toBe(95000)
  })

  it.each(["0", "-5", "abc", "NaN"])(
    "falls back to 95000 for the invalid value %j (never instant-timeout or boot crash)",
    async (value) => {
      process.env.SEEKER_TIMEOUT_MS = value
      // Must not throw at module load even for a non-numeric value.
      const { seekerTimeoutMs } = await importEnv()
      expect(seekerTimeoutMs()).toBe(95000)
    },
  )
})

describe("sub-ceiling timeout warning (KTD4)", () => {
  it("warns at module load when the timeout is below the 90s route ceiling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.SEEKER_TIMEOUT_MS = "5000"
    const { seekerTimeoutMs } = await importEnv()
    // The value is still honored (lowering is a documented escape hatch)...
    expect(seekerTimeoutMs()).toBe(5000)
    // ...but the misconfig is surfaced, not silent.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("event=timeout_below_route_ceiling"),
    )
    warn.mockRestore()
  })

  it.each(["120000", undefined])(
    "does not warn for %j (at/above ceiling, or unset)",
    async (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      if (value !== undefined) process.env.SEEKER_TIMEOUT_MS = value
      await importEnv()
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    },
  )
})
