import { describe, expect, it, vi } from "vitest"

import {
  createStudioAccessService,
  type StudioAccessRecord,
  type StudioAccessRepository,
} from "./studio-access.service"

function record(
  overrides: Partial<StudioAccessRecord> = {},
): StudioAccessRecord {
  return {
    id: "access-1",
    subject: "user-1",
    email: "user@example.com",
    name: "User",
    status: "approved",
    role: "editor",
    ...overrides,
  }
}

function repository(
  found: StudioAccessRecord | null,
): StudioAccessRepository & {
  requestAccess: ReturnType<typeof vi.fn>
  markAccessed: ReturnType<typeof vi.fn>
  upsertBootstrapAdmin: ReturnType<typeof vi.fn>
  listByEmails: ReturnType<typeof vi.fn>
  approveByEmail: ReturnType<typeof vi.fn>
  revokeByEmail: ReturnType<typeof vi.fn>
} {
  return {
    findBySubjectOrEmail: vi.fn(async () => found),
    upsertBootstrapAdmin: vi.fn(async (input) =>
      record({ ...input, role: "admin" }),
    ),
    requestAccess: vi.fn(async (input) =>
      record({ ...input, status: "pending" }),
    ),
    listByEmails: vi.fn(async ({ emails }) =>
      emails.map((email: string) => record({ email })),
    ),
    list: vi.fn(async () => []),
    approve: vi.fn(async () => record()),
    approveByEmail: vi.fn(async (input) => record({ ...input })),
    revoke: vi.fn(async () => record({ status: "revoked" })),
    revokeByEmail: vi.fn(async (input) =>
      record({ ...input, status: "revoked" }),
    ),
    updateRole: vi.fn(async () => record({ role: "admin" })),
    markAccessed: vi.fn(async () => undefined),
  }
}

describe("Studio access service", () => {
  it("allows approved editors and marks access", async () => {
    const repo = repository(record({ role: "editor" }))
    const service = createStudioAccessService({ repository: repo })

    await expect(
      service.resolve({ subject: "user-1", email: "User@Example.com" }),
    ).resolves.toMatchObject({ allowed: true, role: "editor" })
    expect(repo.markAccessed).toHaveBeenCalledWith({ id: "access-1" })
  })

  it("revalidates playback access without writing access telemetry", async () => {
    const repo = repository(record())
    const service = createStudioAccessService({ repository: repo })

    await expect(
      service.resolve(
        { subject: "subject-1", email: "editor@example.com" },
        { recordAccess: false },
      ),
    ).resolves.toMatchObject({ allowed: true, role: "editor" })
    expect(repo.markAccessed).not.toHaveBeenCalled()
  })

  it("creates a pending request for signed-in users without access", async () => {
    const repo = repository(null)
    const service = createStudioAccessService({ repository: repo })

    await expect(
      service.resolve({ subject: "user-1", email: "User@Example.com" }),
    ).resolves.toEqual({ allowed: false, reason: "pending" })
    expect(repo.requestAccess).toHaveBeenCalledWith({
      subject: "user-1",
      email: "user@example.com",
      name: undefined,
    })
  })

  it("denies revoked users", async () => {
    const service = createStudioAccessService({
      repository: repository(record({ status: "revoked" })),
    })

    await expect(
      service.resolve({ subject: "user-1", email: "user@example.com" }),
    ).resolves.toEqual({ allowed: false, reason: "revoked" })
  })

  it("bootstraps configured admin emails", async () => {
    const repo = repository(null)
    const service = createStudioAccessService({
      repository: repo,
      bootstrapAdminEmails: ["first@example.com"],
    })

    await expect(
      service.resolve({ subject: "user-1", email: "FIRST@example.com" }),
    ).resolves.toMatchObject({ allowed: true, role: "admin" })
    expect(repo.upsertBootstrapAdmin).toHaveBeenCalledWith({
      subject: "user-1",
      email: "first@example.com",
      name: undefined,
    })
  })

  it("requires admin for management", async () => {
    await expect(
      createStudioAccessService({
        repository: repository(record({ role: "admin" })),
      }).requireAdmin({ subject: "admin", email: "admin@example.com" }),
    ).resolves.toBe(true)
    await expect(
      createStudioAccessService({
        repository: repository(record({ role: "editor" })),
      }).requireAdmin({ subject: "editor", email: "editor@example.com" }),
    ).resolves.toBe(false)
  })

  it("normalizes and dedupes admin API email lookups", async () => {
    const repo = repository(null)
    const service = createStudioAccessService({ repository: repo })

    await expect(
      service.listByEmails([
        " FIRST@example.com ",
        "first@example.com",
        "",
        "Second@Example.com",
      ]),
    ).resolves.toMatchObject([
      { email: "first@example.com" },
      { email: "second@example.com" },
    ])
    expect(repo.listByEmails).toHaveBeenCalledWith({
      emails: ["first@example.com", "second@example.com"],
    })
  })

  it("normalizes admin API grant and revoke emails", async () => {
    const repo = repository(null)
    const service = createStudioAccessService({ repository: repo })

    await service.approveByEmail({
      email: "User@Example.com",
      role: "editor",
      approvedBy: "admin-user",
    })
    await service.revokeByEmail({ email: "User@Example.com" })

    expect(repo.approveByEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      role: "editor",
      approvedBy: "admin-user",
    })
    expect(repo.revokeByEmail).toHaveBeenCalledWith({
      email: "user@example.com",
    })
  })
})
