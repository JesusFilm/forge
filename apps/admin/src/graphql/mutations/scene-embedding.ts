// Scene embedding mutations.
//
// `triggerSceneEmbeddingBackfill` kicks off the useworkflow backfill job
// that re-indexes apps/manager's scene-analysis artifacts into admin's
// VideoScene + VideoSceneLocale tables. ADMIN-only via scope-auth; the
// indexer itself rejects non-SYSTEM/non-ADMIN principals as
// defense-in-depth (R1 Key Decisions).
//
// The resolver dispatches through `start()` from `workflow/api` — not a
// direct function call. `"use workflow"` functions are transformed by
// the `workflow/next` build plugin so they must be started via the
// runtime; calling them directly throws `"You attempted to execute
// workflow ... directly"` in production. See
// docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.

import { start } from "workflow/api"
import { builder } from "@/graphql/builder"
import {
  runSceneEmbeddingBackfill,
  type SceneEmbeddingBackfillInput,
  type SceneEmbeddingBackfillReport,
} from "@/workflows/sceneEmbeddingBackfill"

/**
 * Dispatch the scene-embedding backfill workflow via the useworkflow
 * runtime and await the final report. Exported separately from the
 * resolver so dispatch can be asserted without building the Pothos
 * schema in tests.
 */
export async function dispatchSceneEmbeddingBackfill(
  input: SceneEmbeddingBackfillInput,
): Promise<SceneEmbeddingBackfillReport> {
  const run = await start(runSceneEmbeddingBackfill, [input])
  return run.returnValue
}

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
      // JSON scalar accepts any serializable shape; the return type
      // stays fully typed internally via SceneEmbeddingBackfillReport.
      return dispatchSceneEmbeddingBackfill({
        mappingPath: args.mappingPath,
        coreIds: args.coreIds ?? undefined,
        locales: args.locales ?? undefined,
      })
    },
  }),
}))
