import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const capability = {
  downloadId: "download-1",
  variantId: "variant-1",
  videoSlug: "opening-invitation",
  target: "https://stream.mux.com/playback/270p.mp4",
  event: {
    videoId: "video-1",
    videoDubId: "variant-1",
    languageId: "language-1",
  },
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe("watch download capability", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("REVALIDATION_SECRET", "test-revalidation-secret")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("round-trips download metadata without exposing the target", async () => {
    const { createWatchDownloadCapability, readWatchDownloadCapability } =
      await import("./watch-download-capability")

    const token = await createWatchDownloadCapability(capability)

    expect(token).not.toContain("stream.mux.com")
    await expect(readWatchDownloadCapability(token)).resolves.toEqual(
      capability,
    )
  })

  it("mints a fresh opaque token for the same capability payload", async () => {
    const { createWatchDownloadCapability } =
      await import("./watch-download-capability")

    const first = await createWatchDownloadCapability(capability)
    const second = await createWatchDownloadCapability(capability)

    expect(second).not.toBe(first)
  })

  it("rejects a modified capability", async () => {
    const { createWatchDownloadCapability, readWatchDownloadCapability } =
      await import("./watch-download-capability")
    const token = await createWatchDownloadCapability(capability)
    const segments = token.split(".")
    const ciphertext = segments[3] as string
    const mutationIndex = Math.floor(ciphertext.length / 2)
    const current = ciphertext[mutationIndex]
    segments[3] = `${ciphertext.slice(0, mutationIndex)}${
      current === "a" ? "b" : "a"
    }${ciphertext.slice(mutationIndex + 1)}`

    await expect(
      readWatchDownloadCapability(segments.join(".")),
    ).resolves.toBeNull()
  })

  it("binds an authenticated subject without exposing it", async () => {
    const { createWatchDownloadCapability, readWatchDownloadCapability } =
      await import("./watch-download-capability")
    const subjectCapability = { ...capability, subject: "user_123" }

    const token = await createWatchDownloadCapability(subjectCapability)

    expect(token).not.toContain("user_123")
    await expect(readWatchDownloadCapability(token)).resolves.toEqual(
      subjectCapability,
    )
  })

  it("remains valid beyond the former fifteen-minute lifetime", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))
    const { createWatchDownloadCapability, readWatchDownloadCapability } =
      await import("./watch-download-capability")
    const token = await createWatchDownloadCapability(capability)

    vi.advanceTimersByTime(FIFTEEN_MINUTES_MS + 1)

    await expect(readWatchDownloadCapability(token)).resolves.toEqual(
      capability,
    )
  })

  it("expires after the bounded one-day lifetime", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))
    const { createWatchDownloadCapability, readWatchDownloadCapability } =
      await import("./watch-download-capability")
    const token = await createWatchDownloadCapability(capability)

    vi.advanceTimersByTime(ONE_DAY_MS + 1)

    await expect(readWatchDownloadCapability(token)).resolves.toBeNull()
  })

  it("invalidates outstanding capabilities when the root secret rotates", async () => {
    const { createWatchDownloadCapability } =
      await import("./watch-download-capability")
    const token = await createWatchDownloadCapability(capability)

    vi.stubEnv("REVALIDATION_SECRET", "rotated-revalidation-secret")
    vi.resetModules()
    const { readWatchDownloadCapability } =
      await import("./watch-download-capability")

    await expect(readWatchDownloadCapability(token)).resolves.toBeNull()
  })

  it("rejects oversized capabilities before decryption", async () => {
    const { readWatchDownloadCapability } =
      await import("./watch-download-capability")

    await expect(
      readWatchDownloadCapability("x".repeat(4097)),
    ).resolves.toBeNull()
  })
})
