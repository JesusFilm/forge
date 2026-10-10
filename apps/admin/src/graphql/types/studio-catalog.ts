import { builder } from "@/graphql/builder"
import { StudioCatalogService } from "@/services/studio-authoring/catalog"
import type { ShortRelease } from "@prisma/client"
/** @classification abac-gated */
const release = builder
  .objectRef<ShortRelease>("ShortsCatalogRelease")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      id: t.exposeID("id"),
      projectId: t.exposeID("projectId"),
      revision: t.exposeInt("revision"),
      renderAttemptId: t.exposeID("renderAttemptId"),
      title: t.exposeString("title"),
      languageSlug: t.exposeString("languageSlug"),
      durationMs: t.exposeInt("durationMs"),
      width: t.exposeInt("width"),
      height: t.exposeInt("height"),
      fps: t.exposeInt("fps"),
      muxAssetId: t.exposeID("muxAssetId"),
      muxPlaybackId: t.exposeID("muxPlaybackId"),
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
