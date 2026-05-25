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
} {
  return {
    findBySubjectOrEmail: vi.fn(async () => found),
    requestAccess: vi.fn(async (input) =>
      record({ ...input, status: "pending" }),
    ),
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
})
