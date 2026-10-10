import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { WATCH_PROGRESS_ADMIN_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidWatchProgressBearer } =
  await import("@/auth/watch-progress-bearer")

const envMutable = env as { WATCH_PROGRESS_ADMIN_API_KEYS?: string }

describe("isValidWatchProgressBearer", () => {
  beforeEach(() => {
    envMutable.WATCH_PROGRESS_ADMIN_API_KEYS = "progress-a,progress-b"
  })

  afterEach(() => {
    envMutable.WATCH_PROGRESS_ADMIN_API_KEYS = undefined
  })

  it("accepts a valid bearer token matching the dedicated allowlist", () => {
    expect(isValidWatchProgressBearer("Bearer progress-a")).toBe(true)
    expect(isValidWatchProgressBearer("bearer progress-b")).toBe(true)
  })

  it("rejects unknown keys and non-Bearer schemes", () => {
    expect(isValidWatchProgressBearer("Bearer wrong")).toBe(false)
    expect(isValidWatchProgressBearer("Basic progress-a")).toBe(false)
    expect(isValidWatchProgressBearer("progress-a")).toBe(false)
  })

  it("rejects empty headers and unset allowlists", () => {
    expect(isValidWatchProgressBearer(null)).toBe(false)
    expect(isValidWatchProgressBearer("Bearer ")).toBe(false)

    envMutable.WATCH_PROGRESS_ADMIN_API_KEYS = undefined
    expect(isValidWatchProgressBearer("Bearer progress-a")).toBe(false)
  })

  it("trims whitespace around allowlist entries", () => {
    envMutable.WATCH_PROGRESS_ADMIN_API_KEYS = "  progress-a  ,  progress-b  "
    expect(isValidWatchProgressBearer("Bearer progress-a")).toBe(true)
    expect(isValidWatchProgressBearer("Bearer progress-b")).toBe(true)
  })

  it("rejects partial matches", () => {
    expect(isValidWatchProgressBearer("Bearer progress")).toBe(false)
    expect(isValidWatchProgressBearer("Bearer progress-a-extra")).toBe(false)
  })

  it("does not throw when byte lengths differ", () => {
    envMutable.WATCH_PROGRESS_ADMIN_API_KEYS = "kéy-aaa"
    expect(() => isValidWatchProgressBearer("Bearer key-aaaa")).not.toThrow()
    expect(isValidWatchProgressBearer("Bearer key-aaa")).toBe(false)
  })
})
