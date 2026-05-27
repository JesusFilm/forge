import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function useBaseEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
  delete process.env.NEXT_PUBLIC_YOUVERSION_APP_KEY
  delete process.env.NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID
}

describe("web env — YouVersion public config", () => {
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

    expect(env.NEXT_PUBLIC_YOUVERSION_APP_KEY).toBeUndefined()
    expect(env.NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID).toBe(111)
  })

  it("treats an empty YouVersion default version as absent", async () => {
    process.env.NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID = ""

    const { env } = await import("./env")

    expect(env.NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID).toBe(111)
  })

  it("coerces a configured YouVersion default version id", async () => {
    process.env.NEXT_PUBLIC_YOUVERSION_APP_KEY = "test-yv-app-key"
    process.env.NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID = "59"

    const { env } = await import("./env")

    expect(env.NEXT_PUBLIC_YOUVERSION_APP_KEY).toBe("test-yv-app-key")
    expect(env.NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID).toBe(59)
  })
})
