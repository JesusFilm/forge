import { describe, expect, it, vi } from "vitest"

import {
  recordAdminSubjectBinding,
  resolveAdminUserForSubject,
} from "./admin-subject-binding"

type RecordDb = Parameters<typeof recordAdminSubjectBinding>[0]
type ResolveDb = Parameters<typeof resolveAdminUserForSubject>[0]

function bindingDb(overrides: {
  findUnique?: ReturnType<typeof vi.fn>
  create?: ReturnType<typeof vi.fn>
}) {
  return {
    adminAuthSubjectBinding: {
      findUnique: overrides.findUnique ?? vi.fn(async () => null),
      create: overrides.create ?? vi.fn(async () => ({ subject: "s" })),
      update: vi.fn(async () => ({ subject: "s" })),
    },
  } as unknown as RecordDb
}

describe("recordAdminSubjectBinding", () => {
  it("rethrows a non-unique database failure instead of reporting a conflict", async () => {
    const db = bindingDb({
      create: vi.fn(async () => Promise.reject(new Error("connection reset"))),
    })
    await expect(
      recordAdminSubjectBinding(db, { subject: "s", userId: "u" }),
    ).rejects.toThrow("connection reset")
  })

  it("creates the pair once for a first verified sign-in", async () => {
    const create = vi.fn(async () => ({ subject: "s" }))
    const now = new Date("2026-10-16T00:00:00.000Z")
    await expect(
      recordAdminSubjectBinding(bindingDb({ create }), {
        subject: "s",
        userId: "u",
        now,
      }),
    ).resolves.toEqual({ ok: true })
    expect(create).toHaveBeenCalledWith({
      data: { subject: "s", userId: "u", lastVerifiedAt: now },
      select: { subject: true },
    })
  })
})

describe("resolveAdminUserForSubject", () => {
  function resolveDb(
    binding: unknown,
    legacy: unknown,
  ): ResolveDb & { user: { findUnique: ReturnType<typeof vi.fn> } } {
    return {
      adminAuthSubjectBinding: { findUnique: vi.fn(async () => binding) },
      user: { findUnique: vi.fn(async () => legacy) },
    } as unknown as ResolveDb & {
      user: { findUnique: ReturnType<typeof vi.fn> }
    }
  }

  it("prefers the binding even when a user with id === subject also exists", async () => {
    const db = resolveDb(
      { user: { id: "bound", role: "ADMIN" } },
      { id: "s", role: "ADMIN", authSubjectBinding: null },
    )
    await expect(resolveAdminUserForSubject(db, "s")).resolves.toEqual({
      ok: true,
      user: { id: "bound", role: "ADMIN" },
    })
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it("keeps an unbound legacy subject-id user working", async () => {
    const db = resolveDb(null, {
      id: "s",
      role: "ADMIN",
      authSubjectBinding: null,
    })
    await expect(resolveAdminUserForSubject(db, "s")).resolves.toEqual({
      ok: true,
      user: { id: "s", role: "ADMIN" },
    })
  })

  it("refuses the id fallback once that user is bound to another subject", async () => {
    const db = resolveDb(null, {
      id: "s",
      role: "ADMIN",
      authSubjectBinding: { subject: "other" },
    })
    await expect(resolveAdminUserForSubject(db, "s")).resolves.toEqual({
      ok: false,
      reason: "subject_binding_conflict",
    })
  })
})
