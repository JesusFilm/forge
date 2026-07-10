import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  cookiesMock,
  createUserAdminClientMock,
  mutateMock,
  readWebAuthSessionCookieMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  createUserAdminClientMock: vi.fn(),
  mutateMock: vi.fn(),
  readWebAuthSessionCookieMock: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

vi.mock("@/auth/web-session", () => ({
  WEB_AUTH_SESSION_COOKIE: "forge_web_session",
  readWebAuthSessionCookie: readWebAuthSessionCookieMock,
}))

vi.mock("@/lib/admin-client", () => ({
  createUserAdminClient: createUserAdminClientMock,
}))

describe("recordMeaningfulWatchEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: "encrypted-session" })),
    })
    readWebAuthSessionCookieMock.mockResolvedValue({
      accessToken: "user-access-token",
    })
    mutateMock.mockResolvedValue({
      data: { recordWatchEvent: { id: "event-1" } },
    })
    createUserAdminClientMock.mockReturnValue({ mutate: mutateMock })
  })

  it("records with the signed-in Auth access token", async () => {
    const { recordMeaningfulWatchEvent } = await import("./watch-event-actions")

    await expect(
      recordMeaningfulWatchEvent({
        videoId: "video-1",
        videoDubId: "dub-1",
        positionSeconds: 33.9,
        durationSeconds: 100,
        progress: 1.5,
        requestSessionId: "viewer-1",
      }),
    ).resolves.toEqual({ ok: true, recorded: true })

    expect(createUserAdminClientMock).toHaveBeenCalledWith("user-access-token")
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          videoId: "video-1",
          videoDubId: "dub-1",
          positionSeconds: 33,
          durationSeconds: 100,
          progress: 1,
          requestSessionId: "viewer-1",
        }),
      }),
    )
  })

  it("skips cleanly when signed out", async () => {
    const { recordMeaningfulWatchEvent } = await import("./watch-event-actions")

    readWebAuthSessionCookieMock.mockResolvedValueOnce(null)
    await expect(
      recordMeaningfulWatchEvent({
        videoId: "video-1",
      }),
    ).resolves.toEqual({ ok: true, recorded: false, reason: "signed-out" })
  })
})
