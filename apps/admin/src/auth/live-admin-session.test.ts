import { beforeEach, describe, expect, it, vi } from "vitest"

const state: {
  principal: { id: string | null; role: string }
  liveRole: string | null | Error
} = {
  principal: { id: "admin-user", role: "ADMIN" },
  liveRole: "ADMIN",
}

class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect:${path}`)
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new RedirectSignal(path)
  }),
}))

vi.mock("@/auth/session", () => ({
  requireAdminSession: vi.fn(async () => state.principal),
}))

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => {
        if (state.liveRole instanceof Error) throw state.liveRole
        return state.liveRole === null ? null : { role: state.liveRole }
      }),
    },
  },
}))

import { prisma } from "@/db/client"
import { requireLiveAdminSession } from "./live-admin-session"

beforeEach(() => {
  state.principal = { id: "admin-user", role: "ADMIN" }
  state.liveRole = "ADMIN"
  vi.mocked(prisma.user.findUnique).mockClear()
})

describe("requireLiveAdminSession", () => {
  it("returns the session actor id when the live role is ADMIN", async () => {
    await expect(requireLiveAdminSession()).resolves.toEqual({
      actorId: "admin-user",
    })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-user" },
      select: { role: true },
    })
  })

  it.each([
    ["downgraded to EDITOR", "EDITOR"],
    ["downgraded to VIEWER", "VIEWER"],
    ["deleted", null],
    ["unreadable", new Error("db down")],
  ])("denies an Admin session whose user was %s", async (_label, liveRole) => {
    state.liveRole = liveRole
    await expect(requireLiveAdminSession()).rejects.toMatchObject({
      path: "/dashboard",
    })
  })

  it("denies a session principal without an id", async () => {
    state.principal = { id: null, role: "ADMIN" }
    await expect(requireLiveAdminSession()).rejects.toMatchObject({
      path: "/dashboard",
    })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
