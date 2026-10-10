import { builder } from "@/graphql/builder"
import {
  projectActiveReviewerLanguageGrants,
  type ManagerReviewerLanguageGrantProjection,
} from "@/auth/manager-reviewer-grants"

type ManagerViewer = {
  id: string
  username: string
  email: string
  managerRole: "OPERATOR" | "REVIEWER"
  permission: "access:manager" | "review:subtitles"
  reviewerLanguageGrants: ManagerReviewerLanguageGrantProjection[]
}

const ManagerRoleEnum = builder.enumType("ManagerRole", {
  values: {
    OPERATOR: { value: "OPERATOR" },
    REVIEWER: { value: "REVIEWER" },
  } as const,
})

const ManagerReviewerSpecialistCapabilitiesRef = builder
  .objectRef<
    ManagerReviewerLanguageGrantProjection["specialistCapabilities"]
  >("ManagerReviewerSpecialistCapabilities")
  .implement({
    description:
      "Specialist review capabilities attached to one exact language grant.",
    fields: (t) => ({
      scripture: t.exposeBoolean("scripture"),
      theology: t.exposeBoolean("theology"),
    }),
  })

const ManagerReviewerLanguageGrantRef = builder
  .objectRef<ManagerReviewerLanguageGrantProjection>(
    "ManagerReviewerLanguageGrant",
  )
  .implement({
    description:
      "Active subtitle-review authorization bound to one Admin language identity.",
    fields: (t) => ({
      id: t.exposeID("id"),
      languageId: t.exposeID("languageId"),
      languageSlug: t.exposeString("languageSlug"),
      languageBcp47: t.exposeString("languageBcp47", { nullable: true }),
      permittedRubricDimensions: t.field({
        type: ["String"],
        resolve: (row) => row.permittedRubricDimensions,
      }),
      specialistCapabilities: t.field({
        type: ManagerReviewerSpecialistCapabilitiesRef,
        resolve: (row) => row.specialistCapabilities,
      }),
    }),
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
      reviewerLanguageGrants: t.field({
        type: [ManagerReviewerLanguageGrantRef],
        resolve: (row) => row.reviewerLanguageGrants,
      }),
    }),
  })

builder.queryFields((t) => ({
  managerViewer: t.field({
    type: ManagerViewerRef,
    nullable: true,
    description:
      "Current Admin session projected into the narrow Manager access contract.",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.user?.id) {
        return null
      }
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          managerMembership: {
            select: {
              role: true,
              revokedAt: true,
              reviewerLanguageGrants: {
                select: {
                  id: true,
                  languageId: true,
                  permittedRubricDimensions: true,
                  scriptureSpecialist: true,
                  theologySpecialist: true,
                  revokedAt: true,
                  language: {
                    select: {
                      id: true,
                      slug: true,
                      bcp47: true,
                      deletedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      if (!user?.managerMembership || user.managerMembership.revokedAt) {
        return null
      }
      const reviewerLanguageGrants = projectActiveReviewerLanguageGrants(
        user.managerMembership.reviewerLanguageGrants,
      )
      if (
        user.managerMembership.role === "REVIEWER" &&
        reviewerLanguageGrants.length === 0
      ) {
        return null
      }
      return {
        id: user.id,
        username: user.name ?? user.email,
        email: user.email,
        managerRole: user.managerMembership.role,
        permission:
          user.managerMembership.role === "OPERATOR"
            ? ("access:manager" as const)
            : ("review:subtitles" as const),
        reviewerLanguageGrants,
      }
    },
  }),
}))
