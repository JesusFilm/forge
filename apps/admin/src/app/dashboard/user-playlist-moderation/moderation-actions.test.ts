import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  principal: { id: "admin-1", role: "ADMIN" } as {
    id: string
    role: "ADMIN" | "EDITOR"
  },
  permission: true,
  block: vi.fn(),
  restore: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/auth/session", () => ({
  requireAdminSession: vi.fn(async () => state.principal),
}))

vi.mock("@/auth/permissions", () => ({
  hasPermission: vi.fn(() => state.permission),
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/graphql/user-playlist-runtime", () => ({
  getUserPlaylistGraphqlRuntime: vi.fn(() => ({
    moderation: () => ({ block: state.block, restore: state.restore }),
  })),
}))

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }))

import { moderateUserPlaylist } from "./moderation-actions"

describe("user playlist moderation action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.principal = { id: "admin-1", role: "ADMIN" }
    state.permission = true
    state.block.mockResolvedValue({
      playlistId: "playlist_1",
      moderationState: "BLOCKED",
      changed: true,
      auditedAt: new Date("2026-08-21T12:00:00Z"),
    })
    state.restore.mockResolvedValue({
      playlistId: "playlist_1",
      moderationState: "ACTIVE",
      changed: true,
      auditedAt: new Date("2026-08-21T12:00:00Z"),
    })
  })

  it("uses the authenticated principal and a closed block reason", async () => {
    await expect(
      moderateUserPlaylist({
        playlistId: "playlist_1",
        action: "BLOCK",
        reason: "SAFETY",
      }),
    ).resolves.toEqual({
      status: "success",
      action: "BLOCK",
      playlistId: "playlist_1",
      changed: true,
    })

    expect(state.block).toHaveBeenCalledWith(
      { playlistId: "playlist_1", reasonCode: "SAFETY" },
      state.principal,
    )
    expect(state.restore).not.toHaveBeenCalled()
    expect(state.revalidatePath).toHaveBeenCalledWith(
      "/dashboard/user-playlist-moderation",
    )
  })

  it("uses only a closed restore reason", async () => {
    await moderateUserPlaylist({
      playlistId: "playlist_1",
      action: "RESTORE",
      reason: "APPEAL_APPROVED",
    })

    expect(state.restore).toHaveBeenCalledWith(
      { playlistId: "playlist_1", reasonCode: "APPEAL_APPROVED" },
      state.principal,
    )
  })

  it("rejects malformed ids, mismatched reasons, and principals without the exact permission", async () => {
    await expect(
      moderateUserPlaylist({
        playlistId: "../../owner-token",
        action: "BLOCK",
        reason: "SAFETY",
      }),
    ).resolves.toEqual({ status: "error" })
    await expect(
      moderateUserPlaylist({
        playlistId: "playlist_1",
        action: "BLOCK",
        reason: "APPEAL_APPROVED",
      }),
    ).resolves.toEqual({ status: "error" })

    state.permission = false
    await expect(
      moderateUserPlaylist({
        playlistId: "playlist_1",
        action: "RESTORE",
        reason: "REVIEW_CLEARED",
      }),
    ).resolves.toEqual({ status: "error" })
    expect(state.block).not.toHaveBeenCalled()
    expect(state.restore).not.toHaveBeenCalled()
  })

  it("returns a bounded error state without leaking service details", async () => {
    state.block.mockRejectedValueOnce(
      new Error("ciphertext key owner-subject=secret"),
    )

    await expect(
      moderateUserPlaylist({
        playlistId: "playlist_1",
        action: "BLOCK",
        reason: "ABUSE",
      }),
    ).resolves.toEqual({ status: "error" })
  })
})
