/** @classification public-shape */
import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import { resolveRecommendationOperation } from "@/graphql/recommendation-errors"
import { RecommendationViewerService } from "@/services/recommendations/viewer-identity.service"

const ViewerRef = builder.objectRef<{
  viewerToken: string
  sessionToken: string
  expiresAt: string
  personalization: boolean
}>("RecommendationViewer")
ViewerRef.implement({
  fields: (t) => ({
    viewerToken: t.exposeString("viewerToken", { nullable: false }),
    sessionToken: t.exposeString("sessionToken", { nullable: false }),
    expiresAt: t.exposeString("expiresAt", { nullable: false }),
    personalization: t.exposeBoolean("personalization", { nullable: false }),
  }),
})
const StatusRef = builder.objectRef<{
  state: string
  personalization: boolean
}>("RecommendationViewerStatus")
StatusRef.implement({
  fields: (t) => ({
    state: t.exposeString("state", { nullable: false }),
    personalization: t.exposeBoolean("personalization", { nullable: false }),
  }),
})
builder.mutationFields((t) => ({
  createRecommendationViewer: t.field({
    type: ViewerRef,
    nullable: false,
    authScopes: { public: true },
    resolve: (_root, _args, ctx) =>
      resolveRecommendationOperation(() =>
        new RecommendationViewerService(prisma).bootstrap(ctx.user),
      ),
  }),
  updateRecommendationViewer: t.field({
    type: StatusRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      viewerToken: t.arg.string({ required: true }),
      sessionToken: t.arg.string({ required: true }),
      action: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        new RecommendationViewerService(prisma).transition(ctx.user, args),
      ),
  }),
}))
