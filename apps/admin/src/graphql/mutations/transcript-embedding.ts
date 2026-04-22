// Transcript embedding mutations.
//
// `triggerTranscriptEmbeddingBackfill` kicks off the useworkflow
// backfill job that re-indexes apps/manager's embeddings.json artifacts
// into admin's VideoTranscript + VideoTranscriptChunk tables. ADMIN-only
// via scope-auth; the indexer itself rejects non-SYSTEM/non-ADMIN
// principals as defense-in-depth.
//
// R2 divergence from R1: vectors are REUSED from the artifact, not
// regenerated. The workflow body does not call the embedding provider
// at all — no OpenRouter spend on backfill.
//
// The resolver dispatches through `start()` from `workflow/api` — not
// a direct function call. `"use workflow"` functions are transformed
// by the `workflow/next` build plugin so they must be started via the
// runtime; calling them directly throws `"You attempted to execute
// workflow ... directly"` in production. See
// docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.

import { start } from "workflow/api"
import { builder } from "@/graphql/builder"
import { DEFAULT_CORE_ID_MAPPING_S3_KEY } from "@/services/core-id-mapping.service"
import {
  runTranscriptEmbeddingBackfill,
  type TranscriptEmbeddingBackfillInput,
  type TranscriptEmbeddingBackfillReport,
} from "@/workflows/transcriptEmbeddingBackfill"

/**
 * Dispatch the transcript-embedding backfill workflow via the
 * useworkflow runtime and await the final report. Exported separately
 * from the resolver so dispatch can be asserted without building the
 * Pothos schema in tests.
 */
export async function dispatchTranscriptEmbeddingBackfill(
  input: TranscriptEmbeddingBackfillInput,
): Promise<TranscriptEmbeddingBackfillReport> {
  const run = await start(runTranscriptEmbeddingBackfill, [input])
  return run.returnValue
}

builder.mutationFields((t) => ({
  triggerTranscriptEmbeddingBackfill: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:transcript-embeddings" },
    description:
      "Enqueue the transcript-embedding backfill workflow. Re-indexes apps/manager's embeddings.json artifacts into VideoTranscript + VideoTranscriptChunk. Vectors are reused from the artifact (no OpenRouter call). ADMIN-only.",
    args: {
      mappingS3Key: t.arg.string({
        required: false,
        defaultValue: DEFAULT_CORE_ID_MAPPING_S3_KEY,
        description:
          "S3 key of the coreId → cms video id mapping snapshot (uploaded via `pnpm --filter @forge/admin refresh:core-id-mapping`, shared with scene-embedding backfill). Defaults to admin-migrations/core-id-mapping.json.",
      }),
      coreIds: t.arg.stringList({
        required: false,
        description: "Restrict to these coreIds. Omitted = all mapped videos.",
      }),
      languages: t.arg.stringList({
        required: false,
        description:
          "Inclusion filter on each target's resolved BCP-47 language (Video.primaryLanguage.bcp47, or 'en' when unset). NOT an override for the stamped language on the written row — manager writes one embeddings.json per asset, so the stamped language is derived per target, not per caller. Omitted = accept any resolved language.",
      }),
    },
    resolve: async (_root, args) => {
      // JSON scalar accepts any serializable shape; the return type
      // stays fully typed internally via TranscriptEmbeddingBackfillReport.
      return dispatchTranscriptEmbeddingBackfill({
        mappingS3Key: args.mappingS3Key ?? DEFAULT_CORE_ID_MAPPING_S3_KEY,
        coreIds: args.coreIds ?? undefined,
        languages: args.languages ?? undefined,
      })
    },
  }),
}))
