import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { USER_PLAYLIST_ERASURE_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidUserPlaylistErasureBearer } =
  await import("./user-playlist-erasure-bearer")
const { getUserPlaylistErasureSubjectDigestKey } =
  await import("./user-playlist-erasure-bearer")

const mutableEnv = env as { USER_PLAYLIST_ERASURE_API_KEYS?: string }

describe("isValidUserPlaylistErasureBearer", () => {
  beforeEach(() => {
    mutableEnv.USER_PLAYLIST_ERASURE_API_KEYS = "erase-a,erase-b"
  })

  afterEach(() => {
    mutableEnv.USER_PLAYLIST_ERASURE_API_KEYS = undefined
  })

  it("accepts only an exact dedicated erasure bearer", () => {
    expect(isValidUserPlaylistErasureBearer("Bearer erase-a")).toBe(true)
    expect(isValidUserPlaylistErasureBearer("Bearer erase-b")).toBe(true)
    expect(isValidUserPlaylistErasureBearer("Bearer lifecycle-secret")).toBe(
      false,
    )
    expect(isValidUserPlaylistErasureBearer("Bearer erase-a-extra")).toBe(false)
  })

  it("fails closed when the allowlist is absent", () => {
    mutableEnv.USER_PLAYLIST_ERASURE_API_KEYS = undefined
    expect(isValidUserPlaylistErasureBearer("Bearer erase-a")).toBe(false)
    expect(isValidUserPlaylistErasureBearer(null)).toBe(false)
  })

  it("accepts only a canonical 32-byte base64url subject-digest key", () => {
    const withDigest = mutableEnv as typeof mutableEnv & {
      USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY?: string
    }
    withDigest.USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY = Buffer.alloc(
      32,
      7,
    ).toString("base64url")
    expect(getUserPlaylistErasureSubjectDigestKey()).toHaveLength(32)

    withDigest.USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY = "not-a-32-byte-key"
    expect(getUserPlaylistErasureSubjectDigestKey()).toBeNull()
    withDigest.USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY = undefined
  })
})
