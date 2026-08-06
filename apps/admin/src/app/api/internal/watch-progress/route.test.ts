import { beforeEach, describe, expect, it, vi } from "vitest"

const deleteWatchProgressForUser = vi.fn()
const deleteWatchEventsForUser = vi.fn()

vi.mock("@/auth/watch-progress-bearer", () => ({
  isValidWatchProgressBearer: (header: string | null) =>
    header === "Bearer valid-erasure-key",
}))

vi.mock("@/db/client", () => ({
  prisma: {
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => await fn({}),
    ),
  },
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

  it("erases progress and, for an account deletion, the watch-event log too (R5)", async () => {
    const { DELETE } = await import("./route")

    const response = await DELETE(
      new Request("http://localhost/api/internal/watch-progress", {
        method: "DELETE",
        headers: {
          authorization: "Bearer valid-erasure-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "auth-user-123",
          reason: "account-deleted",
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      deletedCount: 3,
      deletedWatchEventCount: 5,
    })
    expect(deleteWatchProgressForUser).toHaveBeenCalledWith(
      "auth-user-123",
      expect.anything(),
    )
    expect(deleteWatchEventsForUser).toHaveBeenCalledWith(
      expect.anything(),
      "auth-user-123",
    )
  })

  it("records which caller erased, since both send the same userId body", async () => {
    // apps/auth (account deletion) and apps/web (a user clearing their own
    // history) are otherwise indistinguishable here.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { DELETE } = await import("./route")

    await DELETE(
      new Request("http://localhost/api/internal/watch-progress", {
        method: "DELETE",
        headers: {
          authorization: "Bearer valid-erasure-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "auth-user-123",
          reason: "account-deleted",
        }),
      }),
    )

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=account-deleted"),
    )
    warn.mockRestore()
  })

  it("still erases for a caller that sends no reason (apps/web today)", async () => {
    // The field is optional on purpose: web's existing call must keep
    // working untouched.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
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
    expect(deleteWatchProgressForUser).toHaveBeenCalledWith(
      "auth-user-123",
      expect.anything(),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=unspecified"),
    )
    warn.mockRestore()
  })

  it("rejects an unrecognised reason rather than logging it verbatim", async () => {
    const { DELETE } = await import("./route")

    const response = await DELETE(
      new Request("http://localhost/api/internal/watch-progress", {
        method: "DELETE",
        headers: {
          authorization: "Bearer valid-erasure-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId: "auth-user-123", reason: "whatever" }),
      }),
    )

    expect(response.status).toBe(400)
    expect(deleteWatchProgressForUser).not.toHaveBeenCalled()
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

  it("leaves the watch-event log alone for a clear-history caller", async () => {
    // apps/web calls this same route with no reason when a user clears their
    // own history; wiping their analytics log too is not what they asked for.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
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
    expect(deleteWatchProgressForUser).toHaveBeenCalled()
    expect(deleteWatchEventsForUser).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      deletedWatchEventCount: 0,
    })
    warn.mockRestore()
  })

  it("runs both erasures in one transaction", async () => {
    // A partial erasure leaves apps/auth aborting the deletion while telling
    // the user nothing changed, with progress rows already gone.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { prisma } = await import("@/db/client")
    const { DELETE } = await import("./route")

    await DELETE(
      new Request("http://localhost/api/internal/watch-progress", {
        method: "DELETE",
        headers: {
          authorization: "Bearer valid-erasure-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "auth-user-123",
          reason: "account-deleted",
        }),
      }),
    )

    expect(prisma.$transaction).toHaveBeenCalled()
    warn.mockRestore()
  })
})
