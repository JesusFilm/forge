import { builder } from "@/graphql/builder"
import { hasPermission } from "@/auth/permissions"
import { auth } from "@/auth/config"
import { prisma } from "@/db/client"

type ManagerViewer = {
  id: string
  username: string
  email: string
  role: string
  managerRole: "OPERATOR"
  permission: string
}

type ManagerAuthPayload = {
  token: string
  user: ManagerViewer
}

const ManagerRoleEnum = builder.enumType("ManagerRole", {
  values: {
    OPERATOR: { value: "OPERATOR" },
  } as const,
})

const ManagerViewerRef = builder
  .objectRef<ManagerViewer>("ManagerViewer")
  .implement({
    description:
      "Manager-scoped interactive user shape backed by Admin Better Auth.",
    fields: (t) => ({
      id: t.exposeID("id"),
      username: t.exposeString("username"),
      email: t.exposeString("email"),
      role: t.exposeString("role"),
      managerRole: t.field({
        type: ManagerRoleEnum,
        nullable: false,
        resolve: (row) => row.managerRole,
      }),
      permission: t.exposeString("permission"),
    }),
  })

const ManagerAuthPayloadRef = builder
  .objectRef<ManagerAuthPayload>("ManagerAuthPayload")
  .implement({
    fields: (t) => ({
      token: t.exposeString("token"),
      user: t.field({
        type: ManagerViewerRef,
        resolve: (row) => row.user,
      }),
    }),
  })

async function userToManagerViewer(
  userId: string,
): Promise<ManagerViewer | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      managerMembership: {
        select: { role: true, revokedAt: true },
      },
    },
  })
  const managerRole =
    user?.managerMembership?.revokedAt == null
      ? user?.managerMembership?.role
      : null
  if (
    !user ||
    !hasPermission(
      { id: user.id, role: user.role, managerRole },
      "access:manager",
    )
  ) {
    return null
  }
  return {
    id: user.id,
    username: user.name ?? user.email,
    email: user.email,
    role: user.role,
    managerRole: managerRole as "OPERATOR",
    permission: "access:manager",
  }
}

function extractSessionCookie(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie")
  return setCookie?.split(";")[0] ?? null
}

builder.queryFields((t) => ({
  managerViewer: t.field({
    type: ManagerViewerRef,
    nullable: true,
    authScopes: { hasPermission: "access:manager" },
    description:
      "Current Admin session projected into the narrow Manager access contract.",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.user?.id || !hasPermission(ctx.user, "access:manager")) {
        return null
      }
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          email: true,
          role: true,
          managerMembership: {
            select: { role: true, revokedAt: true },
          },
        },
      })
      if (!user) {
        return null
      }
      const managerRole =
        user.managerMembership?.revokedAt == null
          ? user.managerMembership?.role
          : null
      if (managerRole !== "OPERATOR") {
        return null
      }
      return {
        id: user.id,
        username: user.email,
        email: user.email,
        role: user.role,
        managerRole: managerRole as "OPERATOR",
        permission: "access:manager",
      }
    },
  }),
  managerSession: t.field({
    type: ManagerViewerRef,
    nullable: true,
    description:
      "Validates a Manager-held Admin session cookie from request headers and returns the Manager user shape.",
    resolve: async (_root, _args, ctx) => {
      const session = await auth.api.getSession({
        headers: ctx.request.headers,
      })
      if (!session?.user?.id) return null
      const user = await userToManagerViewer(session.user.id)
      return user
    },
  }),
}))

builder.mutationFields((t) => ({
  managerLogin: t.field({
    type: ManagerAuthPayloadRef,
    nullable: true,
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
    },
    description:
      "Signs in with Admin Better Auth and returns a Manager-held session token.",
    resolve: async (_root, args, ctx) => {
      const response = await auth.api.signInEmail({
        headers: ctx.request.headers,
        asResponse: true,
        body: {
          email: args.email,
          password: args.password,
        },
      })
      if (!response.ok) return null
      const cookie = extractSessionCookie(response)
      if (!cookie) return null

      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      if (!session?.user?.id) return null
      const user = await userToManagerViewer(session.user.id)
      return user ? { token: cookie, user } : null
    },
  }),
  managerLogout: t.field({
    type: "Boolean",
    description: "Revokes the Manager-held Admin session in Better Auth.",
    resolve: async (_root, _args, ctx) => {
      const response = await auth.api.signOut({
        headers: ctx.request.headers,
      })
      return response.success === true
    },
  }),
}))
