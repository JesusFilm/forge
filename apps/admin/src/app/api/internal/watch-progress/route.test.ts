import { beforeEach, describe, expect, it, vi } from "vitest"

const deleteWatchProgressForUser = vi.fn()
const deleteWatchEventsForUser = vi.fn()

vi.mock("@/auth/watch-progress-bearer", () => ({
  isValidWatchProgressBearer: (header: string | null) =>
    header === "Bearer valid-erasure-key",
}))

vi.mock("@/db/client", () => ({
  prisma: {},
}))

vi.mock("@/services/watch-progress.service", () => ({
  deleteWatchProgressForUser,
  listWatchProgress: vi.fn(),
  upsertWatchProgress: vi.fn(),
}))

vi.mock("@/services/watch-events.service", () => ({
  deleteWatchEventsForUser,
}))

describe("DELETE /api/internal/watch-progress", () => {
  beforeEach(() => {
    deleteWatchProgressForUser.mockReset()
    deleteWatchEventsForUser.mockReset()
    deleteWatchProgressForUser.mockResolvedValue({ deletedCount: 3 })
    deleteWatchEventsForUser.mockResolvedValue({ deletedCount: 5 })
  })

  it("erases progress AND watch events for the user in one call (R5)", async () => {
    const { DELETE } = await import("./route")

    const response = await DELETE(
      new Request("http://localhost/api/internal/watch-progress", {
        method: "DELETE",
        headers: {
          authorization: "Bearer valid-erasure-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId: "auth-user-123" }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      deletedCount: 3,
      deletedWatchEventCount: 5,
    })
    expect(deleteWatchProgressForUser).toHaveBeenCalledWith("auth-user-123")
    expect(deleteWatchEventsForUser).toHaveBeenCalledWith(
      expect.anything(),
      "auth-user-123",
    )
  })

  it("rejects erasure without a valid bearer", async () => {
    const { DELETE } = await import("./route")

    const response = await DELETE(
      new Request("http://localhost/api/internal/watch-progress", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "auth-user-123" }),
      }),
    )

    expect(response.status).toBe(401)
    expect(deleteWatchProgressForUser).not.toHaveBeenCalled()
    expect(deleteWatchEventsForUser).not.toHaveBeenCalled()
  })
})
