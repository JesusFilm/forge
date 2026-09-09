import { builder } from "@/graphql/builder"
import { StudioCatalogService } from "@/services/studio-authoring/catalog"
import type { StudioCatalogRelease } from "@prisma/client"
/** @classification abac-gated */
const release = builder
  .objectRef<StudioCatalogRelease>("ShortsCatalogRelease")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      id: t.exposeID("id"),
      projectId: t.exposeID("projectId"),
      revision: t.exposeInt("revision"),
      renderAttemptId: t.exposeID("renderAttemptId"),
      videoId: t.exposeID("videoId"),
      dubId: t.exposeID("dubId"),
      editionId: t.exposeID("editionId"),
      muxId: t.exposeID("muxId"),
      snapshot: t.field({ type: "JSON", resolve: (r) => r.snapshot }),
    }),
  })
builder.queryFields((t) => ({
  shortsCatalogRelease: t.field({
    type: release,
    authScopes: { loggedIn: true },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_, a, c) =>
      new StudioCatalogService(c.prisma).read(c.user, String(a.id)),
  }),
}))
builder.mutationFields((t) => ({
  stageShortsCatalog: t.field({
    type: release,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioCatalogService(c.prisma).stage(c.user, a.input),
  }),
}))
