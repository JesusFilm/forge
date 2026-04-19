// Scene embedding mutations.
//
// `triggerSceneEmbeddingBackfill` kicks off the useworkflow backfill job
// that re-indexes apps/manager's scene-analysis artifacts into admin's
// VideoScene + VideoSceneLocale tables. ADMIN-only via scope-auth; the
// indexer itself rejects non-SYSTEM/non-ADMIN principals as
// defense-in-depth (R1 Key Decisions).

import { builder } from "@/graphql/builder"
import { runSceneEmbeddingBackfill } from "@/workflows/sceneEmbeddingBackfill"

builder.mutationFields((t) => ({
  triggerSceneEmbeddingBackfill: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:scene-embeddings" },
    description:
      "Enqueue the scene-embedding backfill workflow. Re-indexes apps/manager's scene-analysis artifacts into VideoScene + VideoSceneLocale. ADMIN-only.",
    args: {
      mappingPath: t.arg.string({
        required: true,
        description:
          "Absolute path to the coreId → cms video id mapping JSON (dumped via `pnpm --filter @forge/cms dump:core-id-mapping`).",
      }),
      coreIds: t.arg.stringList({
        required: false,
        description: "Restrict to these coreIds. Omitted = all mapped videos.",
      }),
      locales: t.arg.stringList({
        required: false,
        description: "Restrict to these locales. Omitted = ['en', 'es', 'fr'].",
      }),
    },
    resolve: async (_root, args) => {
      const report = await runSceneEmbeddingBackfill({
        mappingPath: args.mappingPath,
        ...(args.coreIds ? { coreIds: args.coreIds } : {}),
        ...(args.locales ? { locales: args.locales } : {}),
      })
      return report as unknown as object
    },
  }),
}))
