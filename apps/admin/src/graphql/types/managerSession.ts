import { builder } from "@/graphql/builder"

type ManagerViewer = {
  id: string
  username: string
  email: string
  managerRole: "OPERATOR"
  permission: "access:manager"
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
      "Manager-scoped interactive user shape backed by explicit Admin ManagerMembership.",
    fields: (t) => ({
      id: t.exposeID("id"),
      username: t.exposeString("username"),
      email: t.exposeString("email"),
      managerRole: t.field({
        type: ManagerRoleEnum,
        resolve: (row) => row.managerRole,
      }),
      permission: t.exposeString("permission"),
    }),
  })

builder.queryFields((t) => ({
  managerViewer: t.field({
    type: ManagerViewerRef,
    nullable: true,
    authScopes: { hasPermission: "access:manager" },
    description:
      "Current Admin session projected into the narrow Manager access contract.",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.user?.id || ctx.user.managerRole !== "OPERATOR") {
        return null
      }
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { id: true, email: true, name: true },
      })
      if (!user) {
        return null
      }
      return {
        id: user.id,
        username: user.name ?? user.email,
        email: user.email,
        managerRole: "OPERATOR" as const,
        permission: "access:manager" as const,
      }
    },
  }),
}))
