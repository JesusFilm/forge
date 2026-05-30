import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function useBaseEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
  delete process.env.YOUVERSION_APP_KEY
  delete process.env.YOUVERSION_DEFAULT_VERSION_ID
  delete process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT
}

describe("web env — YouVersion server config", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("imports cleanly without YouVersion config and defaults the Bible version", async () => {
    const { env } = await import("./env")

    expect(env.YOUVERSION_APP_KEY).toBeUndefined()
    expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(3034)
    expect(env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT).toBeUndefined()
  })

  it("reads the optional YouVersion Bible Quotes LaunchDarkly fallback", async () => {
    process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT = "true"

    const { env } = await import("./env")

    expect(env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT).toBe("true")
  })

  it("treats an empty YouVersion default version as absent", async () => {
    process.env.YOUVERSION_DEFAULT_VERSION_ID = ""

    const { env } = await import("./env")

    expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(3034)
  })

  it("coerces a configured YouVersion default version id", async () => {
    process.env.YOUVERSION_APP_KEY = "test-yv-app-key"
    process.env.YOUVERSION_DEFAULT_VERSION_ID = "59"

    const { env } = await import("./env")

    expect(env.YOUVERSION_APP_KEY).toBe("test-yv-app-key")
    expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(59)
  })

  it.each(["abc", "0"])(
    "falls back to the default Bible version when configured as %s",
    async (configuredValue) => {
      process.env.YOUVERSION_DEFAULT_VERSION_ID = configuredValue

      const { env } = await import("./env")

      expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(3034)
    },
  )
})
