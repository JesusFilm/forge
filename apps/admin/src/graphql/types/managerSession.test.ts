import { describe, expect, it, vi } from "vitest"
import { schema } from "@/graphql/schema"

describe("Manager session GraphQL contract", () => {
  it("resolves Manager viewer access from active ManagerMembership", async () => {
    const userFindUnique = vi.fn().mockResolvedValueOnce({
      id: "admin-user-1",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
      },
    })
    const field = schema.getQueryType()!.getFields().managerViewer

    await expect(
      field.resolve?.(
        {},
        {},
        {
          user: { id: "admin-user-1", role: "VIEWER" },
          prisma: {
            user: {
              findUnique: userFindUnique,
            },
          },
        },
        // The resolver does not read GraphQLResolveInfo.
        {} as never,
      ),
    ).resolves.toEqual({
      id: "admin-user-1",
      username: "Manager User",
      email: "manager@example.com",
      managerRole: "OPERATOR",
      permission: "access:manager",
    })
  })

  it("returns null for Admin users without active ManagerMembership", async () => {
    const field = schema.getQueryType()!.getFields().managerViewer

    await expect(
      field.resolve?.(
        {},
        {},
        {
          user: { id: "admin-user-1", role: "ADMIN" },
          prisma: {
            user: {
              findUnique: vi.fn().mockResolvedValueOnce({
                id: "admin-user-1",
                email: "admin@example.com",
                name: "Admin User",
                managerMembership: null,
              }),
            },
          },
        },
        // The resolver does not read GraphQLResolveInfo.
        {} as never,
      ),
    ).resolves.toBeNull()
  })

  it("returns null for service bearer callers", async () => {
    const userFindUnique = vi.fn()
    const field = schema.getQueryType()!.getFields().managerViewer

    await expect(
      field.resolve?.(
        {},
        {},
        {
          user: { id: null, role: "MANAGER_BACKEND" },
          prisma: {
            user: {
              findUnique: userFindUnique,
            },
          },
        },
        // The resolver does not read GraphQLResolveInfo.
        {} as never,
      ),
    ).resolves.toBeNull()

    expect(userFindUnique).not.toHaveBeenCalled()
  })
})
