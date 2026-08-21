import { beforeEach, describe, expect, it, vi } from "vitest"

const erase = vi.fn()

vi.mock("@/config/env", () => ({
  env: {
    USER_PLAYLIST_ERASURE_API_KEYS: "erase-key",
    USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY: Buffer.alloc(32, 7).toString(
      "base64url",
    ),
  },
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/user-playlist-erasure.service", async (loadOriginal) => {
  const original =
    await loadOriginal<
      typeof import("@/services/user-playlist-erasure.service")
    >()
  return {
    ...original,
    UserPlaylistErasureService: class {
      erase = erase
    },
  }
})

describe("POST /api/internal/user-playlists/erasure", () => {
  beforeEach(() => {
    erase.mockReset()
    erase.mockResolvedValue({
      receiptId: "receipt-1",
      idempotencyKey: "account-delete:event-1",
      lifecycleVersion: 7n,
      erasedCount: 2,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    })
  })

  it("passes a validated matching-version request through the separate erasure authority", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("https://admin.example/api/internal/user-playlists/erasure", {
        method: "POST",
        headers: {
          authorization: "Bearer erase-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ownerSubject: "consumer-1",
          lifecycleVersion: "7",
          idempotencyKey: "account-delete:event-1",
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(erase).toHaveBeenCalledWith(
      {
        ownerSubject: "consumer-1",
        lifecycleVersion: 7n,
        idempotencyKey: "account-delete:event-1",
      },
      expect.any(Symbol),
    )
    await expect(response.json()).resolves.toMatchObject({
      receiptId: "receipt-1",
      lifecycleVersion: "7",
      idempotencyKey: "account-delete:event-1",
      erasedCount: 2,
    })
  })

  it("does not accept the lifecycle signature as erasure authority", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("https://admin.example/api/internal/user-playlists/erasure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forge-lifecycle-signature": "v1=pretend",
          "x-forge-lifecycle-timestamp": String(Date.now()),
        },
        body: JSON.stringify({
          ownerSubject: "consumer-1",
          lifecycleVersion: "7",
          idempotencyKey: "account-delete:event-1",
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(erase).not.toHaveBeenCalled()
  })

  it.each([
    {
      ownerSubject: "consumer-1",
      lifecycleVersion: "-1",
      idempotencyKey: "account-delete:event-1",
    },
    {
      ownerSubject: "",
      lifecycleVersion: "7",
      idempotencyKey: "account-delete:event-1",
    },
    {
      ownerSubject: "consumer-1",
      lifecycleVersion: "7",
      idempotencyKey: "short",
    },
  ])("rejects malformed erasure input", async (body) => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("https://admin.example/api/internal/user-playlists/erasure", {
        method: "POST",
        headers: {
          authorization: "Bearer erase-key",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    )

    expect(response.status).toBe(400)
    expect(erase).not.toHaveBeenCalled()
  })
})
