// Transcript embedding mutations.
//
// `triggerTranscriptEmbeddingBackfill` kicks off the useworkflow
// backfill job that reads apps/manager's transcript.json source artifacts,
// launches Mastra for chunk planning + embeddings, and stores vectors through
// Admin's transcript ingest. ADMIN-only via scope-auth.
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

const TranscriptBackfillModeEnum = builder.enumType("TranscriptBackfillMode", {
  description:
    "Overwrite intent for Mastra transcript embedding backfills. Idempotent is the default.",
  values: {
    IDEMPOTENT: { value: "idempotent" },
    REPAIR: { value: "repair" },
    FORCE: { value: "force" },
    MODEL_UPGRADE: { value: "model-upgrade" },
  } as const,
})

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
      "Enqueue the transcript-embedding backfill workflow. Reads apps/manager's transcript.json source artifact, launches Mastra for chunk planning + embeddings, then writes through Admin ingest. One target per (video, edition, language) where the language set is data-derived from the video's primary language + subtitle languages + dub languages. ADMIN-only.",
    args: {
      mappingS3Key: t.arg.string({
        required: false,
        defaultValue: DEFAULT_CORE_ID_MAPPING_S3_KEY,
        description:
          "S3 key of the coreId → cms video id mapping snapshot (uploaded via `pnpm --filter @forge/admin refresh:core-id-mapping`). Defaults to admin-migrations/core-id-mapping.json.",
      }),
      coreIds: t.arg.stringList({
        required: false,
        description: "Restrict to these coreIds. Omitted = all mapped videos.",
      }),
      languages: t.arg.stringList({
        required: false,
        description:
          "Restrict to these BCP-47 tags. Omitted = every language that exists for the videos — the union of each video's primary language, edition-level subtitle languages, and edition-level dub languages, derived at enumeration time. NOT an override for the stamped language on the written row; the arg filters which `(video, edition, language)` targets get processed. The arg is named `languages` because the filter axis is source transcription language, not per-locale publish state.",
      }),
      mode: t.arg({
        type: TranscriptBackfillModeEnum,
        required: false,
        description:
          "Generation mode for Admin ingest. Defaults to IDEMPOTENT; use REPAIR, FORCE, or MODEL_UPGRADE only when intentionally rewriting existing transcript vectors.",
      }),
    },
    resolve: async (_root, args) => {
      // JSON scalar accepts any serializable shape; the return type
      // stays fully typed internally via TranscriptEmbeddingBackfillReport.
      return dispatchTranscriptEmbeddingBackfill({
        mappingS3Key: args.mappingS3Key ?? DEFAULT_CORE_ID_MAPPING_S3_KEY,
        coreIds: args.coreIds ?? undefined,
        languages: args.languages ?? undefined,
        mode: args.mode ?? undefined,
      })
    },
  }),
}))
