/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const { isWatchDownloadAccountGateEnabledMock, randomUUIDMock } = vi.hoisted(
  () => ({
    isWatchDownloadAccountGateEnabledMock: vi.fn(),
    randomUUIDMock: vi.fn(),
  }),
)

vi.mock("node:crypto", () => ({
  randomUUID: randomUUIDMock,
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchDownloadAccountGateEnabled: isWatchDownloadAccountGateEnabledMock,
}))

afterEach(() => {
  isWatchDownloadAccountGateEnabledMock.mockReset()
  randomUUIDMock.mockReset()
  vi.resetModules()
})

describe("evaluateDownloadAccountGate", () => {
  it("creates a stable rollout cookie with the expected attributes when none exists", async () => {
    randomUUIDMock.mockReturnValueOnce("rollout-new")
    isWatchDownloadAccountGateEnabledMock.mockResolvedValueOnce(true)

    const { evaluateDownloadAccountGate } = await import("./download-gate-flag")
    const result = await evaluateDownloadAccountGate(
      new Request("https://example.test/watch/api/auth/session"),
    )

    expect(result.enabled).toBe(true)
    expect(result.setCookieHeader).toContain(
      "forge_download_gate_rollout=rollout-new",
    )
    expect(result.setCookieHeader).toContain("Path=/watch")
    expect(result.setCookieHeader).toContain("Max-Age=31536000")
    expect(result.setCookieHeader).toContain("HttpOnly")
    expect(result.setCookieHeader).toContain("SameSite=Lax")
    expect(isWatchDownloadAccountGateEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        anonymous: true,
        key: "rollout-new",
        kind: "user",
        custom: { route: "/watch/api/auth/session" },
      }),
    )
  })

  it("reuses an existing rollout cookie without rotating it", async () => {
    isWatchDownloadAccountGateEnabledMock.mockResolvedValueOnce(false)

    const { evaluateDownloadAccountGate } = await import("./download-gate-flag")
    const result = await evaluateDownloadAccountGate(
      new Request("https://example.test/watch/api/auth/session", {
        headers: {
          cookie: "forge_download_gate_rollout=rollout-existing",
        },
      }),
    )

    expect(result).toEqual({ enabled: false })
    expect(randomUUIDMock).not.toHaveBeenCalled()
    expect(isWatchDownloadAccountGateEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "rollout-existing",
      }),
    )
  })

  it("rotates malformed rollout cookies instead of throwing", async () => {
    randomUUIDMock.mockReturnValueOnce("rollout-rotated")
    isWatchDownloadAccountGateEnabledMock.mockResolvedValueOnce(false)

    const { evaluateDownloadAccountGate } = await import("./download-gate-flag")
    const result = await evaluateDownloadAccountGate(
      new Request("https://example.test/watch/api/auth/session", {
        headers: {
          cookie: "forge_download_gate_rollout=%E0%A4%A",
        },
      }),
    )

    expect(result.enabled).toBe(false)
    expect(result.setCookieHeader).toContain(
      "forge_download_gate_rollout=rollout-rotated",
    )
    expect(isWatchDownloadAccountGateEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "rollout-rotated",
      }),
    )
  })
})
