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

const AUTH_KEYS = [
  "AUTH_ISSUER_URL",
  "AUTH_CHAT_CLIENT_ID",
  "AUTH_CHAT_CLIENT_SECRET",
  "CHAT_BASE_URL",
  "CHAT_SESSION_SECRET",
  "AUTH_COOKIE_PREFIX",
] as const

// A real (≥32-char, non-placeholder) signing secret for the "configured" cases.
const REAL_SECRET = "a".repeat(40)

function clearSeekerEnv() {
  for (const key of SEEKER_KEYS) delete process.env[key]
  for (const key of AUTH_KEYS) delete process.env[key]
}

// Sets the full happy-path auth env; individual cases delete/override from here.
function setConfiguredAuthEnv() {
  process.env.AUTH_ISSUER_URL = "https://auth.jesusfilm.org/api/auth"
  process.env.AUTH_CHAT_CLIENT_ID = "chat-client"
  process.env.CHAT_BASE_URL = "https://chat.jesusfilm.org"
  process.env.CHAT_SESSION_SECRET = REAL_SECRET
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

describe("chatAuthConfigured (KTD6 / R11 fail-closed)", () => {
  it("is false when all auth vars are unset (parse succeeds, app boots)", async () => {
    const { chatAuthConfigured, env } = await importEnv()
    expect(chatAuthConfigured()).toBe(false)
    expect(env.AUTH_ISSUER_URL).toBeUndefined()
  })

  it("is false when issuer/client-id/base-URL present but signing secret absent", async () => {
    setConfiguredAuthEnv()
    delete process.env.CHAT_SESSION_SECRET
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(false)
  })

  it("is false when the secret equals the shipped .env.example placeholder", async () => {
    setConfiguredAuthEnv()
    const { CHAT_SESSION_SECRET_PLACEHOLDER } = await importEnv()
    process.env.CHAT_SESSION_SECRET = CHAT_SESSION_SECRET_PLACEHOLDER
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(false)
  })

  it("is false when the secret is empty", async () => {
    setConfiguredAuthEnv()
    process.env.CHAT_SESSION_SECRET = ""
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(false)
  })

  it("is false when the secret is shorter than 32 chars", async () => {
    setConfiguredAuthEnv()
    process.env.CHAT_SESSION_SECRET = "a".repeat(31)
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(false)
  })

  it.each(["AUTH_ISSUER_URL", "AUTH_CHAT_CLIENT_ID", "CHAT_BASE_URL"])(
    "is false when %s is missing (secret alone is not enough)",
    async (missing) => {
      setConfiguredAuthEnv()
      delete process.env[missing]
      const { chatAuthConfigured } = await importEnv()
      expect(chatAuthConfigured()).toBe(false)
    },
  )

  it("is false when CHAT_BASE_URL is scheme-less (malformed → fail closed, not a 500)", async () => {
    setConfiguredAuthEnv()
    process.env.CHAT_BASE_URL = "chat.jesusfilm.org" // no scheme
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(false)
  })

  it("is true only when issuer, client id, base URL, and a real secret are all set", async () => {
    setConfiguredAuthEnv()
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(true)
  })

  it("does not require a client secret (public-client / secret optional)", async () => {
    setConfiguredAuthEnv()
    delete process.env.AUTH_CHAT_CLIENT_SECRET
    const { chatAuthConfigured } = await importEnv()
    expect(chatAuthConfigured()).toBe(true)
  })

  it("the shipped .env.example placeholder is the exact single-sourced sentinel", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    // vitest runs from the package root (apps/chat).
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8")
    const { CHAT_SESSION_SECRET_PLACEHOLDER } = await importEnv()
    expect(example).toContain(
      `CHAT_SESSION_SECRET=${CHAT_SESSION_SECRET_PLACEHOLDER}`,
    )
  })
})

describe("chatAuthCookiePrefix", () => {
  it("defaults to forge_chat when unset", async () => {
    const { chatAuthCookiePrefix } = await importEnv()
    expect(chatAuthCookiePrefix()).toBe("forge_chat")
  })

  it("uses AUTH_COOKIE_PREFIX when set", async () => {
    process.env.AUTH_COOKIE_PREFIX = "custom_chat"
    const { chatAuthCookiePrefix } = await importEnv()
    expect(chatAuthCookiePrefix()).toBe("custom_chat")
  })
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
