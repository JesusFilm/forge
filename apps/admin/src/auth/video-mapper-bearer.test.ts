import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { VIDEO_MAPPER_ADMIN_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidVideoMapperBearer } = await import("@/auth/video-mapper-bearer")

const envMutable = env as { VIDEO_MAPPER_ADMIN_API_KEYS?: string }

describe("isValidVideoMapperBearer", () => {
  beforeEach(() => {
    envMutable.VIDEO_MAPPER_ADMIN_API_KEYS = "mapper-a,mapper-b"
  })

  afterEach(() => {
    envMutable.VIDEO_MAPPER_ADMIN_API_KEYS = undefined
  })

  it("accepts a valid bearer token matching any mapper allowlisted key", () => {
    expect(isValidVideoMapperBearer("Bearer mapper-a")).toBe(true)
    expect(isValidVideoMapperBearer("Bearer mapper-b")).toBe(true)
  })

  it("accepts case-insensitive Bearer prefix", () => {
    expect(isValidVideoMapperBearer("bearer mapper-a")).toBe(true)
    expect(isValidVideoMapperBearer("BEARER mapper-a")).toBe(true)
  })

  it("rejects unknown, empty, and non-Bearer tokens", () => {
    expect(isValidVideoMapperBearer("Bearer not-a-real-key")).toBe(false)
    expect(isValidVideoMapperBearer(null)).toBe(false)
    expect(isValidVideoMapperBearer("Bearer ")).toBe(false)
    expect(isValidVideoMapperBearer("Basic mapper-a")).toBe(false)
    expect(isValidVideoMapperBearer("mapper-a")).toBe(false)
  })

  it("rejects when VIDEO_MAPPER_ADMIN_API_KEYS is unset or empty", () => {
    envMutable.VIDEO_MAPPER_ADMIN_API_KEYS = undefined
    expect(isValidVideoMapperBearer("Bearer mapper-a")).toBe(false)

    envMutable.VIDEO_MAPPER_ADMIN_API_KEYS = "  ,  "
    expect(isValidVideoMapperBearer("Bearer mapper-a")).toBe(false)
  })

  it("trims entries and rejects partial matches", () => {
    envMutable.VIDEO_MAPPER_ADMIN_API_KEYS = "  mapper-a  ,  mapper-b  "

    expect(isValidVideoMapperBearer("Bearer mapper-a")).toBe(true)
    expect(isValidVideoMapperBearer("Bearer mapper")).toBe(false)
    expect(isValidVideoMapperBearer("Bearer mapper-a-extra")).toBe(false)
  })
})
