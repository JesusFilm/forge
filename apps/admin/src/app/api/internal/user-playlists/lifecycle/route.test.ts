import { describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    USER_PLAYLIST_LIFECYCLE_HMAC_SECRET:
      "lifecycle-secret-that-is-at-least-32-bytes",
    USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY: Buffer.alloc(32, 7).toString(
      "base64url",
    ),
  },
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

describe("POST /api/internal/user-playlists/lifecycle", () => {
  it("does not accept the separately scoped erasure bearer as lifecycle authority", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request(
        "https://admin.example/api/internal/user-playlists/lifecycle",
        {
          method: "POST",
          headers: {
            authorization: "Bearer playlist-erasure-key",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ownerSubject: "consumer-1",
            state: "DELETING",
            version: "7",
            sourceEventId: "event-delete-1",
            activeLeaseExpiresAt: null,
          }),
        },
      ),
    )

    expect(response.status).toBe(401)
  })
})
