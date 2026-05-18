// Experience embedding backfill mutation.
//
// `triggerExperienceEmbeddingBackfill` enqueues the useworkflow job
// that enumerates eligible ExperienceLocale rows (status='published'
// AND embedding IS NULL by default) and dispatches the per-locale
// `runExperienceEmbedding` workflow for each.
//
// ADMIN-only via Pothos scope-auth on `write:experience-embeddings`.
// The bearer-callable `WORKFLOW_TRIGGER` role is also granted via the
// per-key allowlist in `src/auth/permissions.ts` so `pnpm run-embeds
// --pipeline=experience` (the local-dev CLI shim) and any future
// service-to-service trigger can invoke this path without standing up
// admin's full session-cookie auth flow.
//
// The resolver dispatches through `start()` from `workflow/api` —
// not a direct function call. `"use workflow"` functions are
// transformed by the `workflow/next` build plugin so they must be
// started via the runtime; calling them directly throws in
// production. See
// docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.

import { start } from "workflow/api"
import { builder } from "@/graphql/builder"
import {
  runExperienceEmbeddingBackfill,
  type ExperienceEmbeddingBackfillInput,
  type ExperienceEmbeddingBackfillReport,
} from "@/workflows/experienceEmbeddingBackfill"

/**
 * Dispatch the experience-embedding backfill workflow via the
 * useworkflow runtime and await the final report. Exported separately
 * from the resolver so dispatch can be asserted without building the
 * Pothos schema in tests (matches R1/R2 dispatch-helper convention).
 */
export async function dispatchExperienceEmbeddingBackfill(
  input: ExperienceEmbeddingBackfillInput,
): Promise<ExperienceEmbeddingBackfillReport> {
  const run = await start(runExperienceEmbeddingBackfill, [input])
  return run.returnValue
}

builder.mutationFields((t) => ({
  triggerExperienceEmbeddingBackfill: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:experience-embeddings" },
    description:
      "Enqueue the experience-embedding backfill workflow. Enumerates ExperienceLocale rows (status='published' AND embedding IS NULL by default) and dispatches `runExperienceEmbedding` per locale. The downstream workflow is admin-native — reads ExperienceLocale text + writes the vector back via raw SQL inside a Prisma transaction. ADMIN-only at the editorial-tier ladder; bearer-callable from CLIs via `WORKFLOW_TRIGGER`. Per-target error isolation: a failing embedding for one locale records `failed` and does not halt the run. Reruns are idempotent — the inner workflow upserts the vector by id.",
    args: {
      experienceIds: t.arg.idList({
        required: false,
        description:
          "Restrict to ExperienceLocale rows whose parent Experience.id is in this set. Omitted = every published Experience.",
      }),
      bcp47Locales: t.arg.stringList({
        required: false,
        description:
          'Restrict to ExperienceLocale rows whose `locale` is in this BCP-47 set, e.g. ["en", "es"]. Omitted = every locale that exists in the corpus, data-derived at enumeration time. No hardcoded list, no `en` fallback.',
      }),
      force: t.arg.boolean({
        required: false,
        defaultValue: false,
        description:
          "When true, include rows that already have a non-NULL embedding (re-embed them). Default false — only rows with `embedding IS NULL` are enumerated. Use for model upgrades or drift fixes.",
      }),
    },
    resolve: async (_root, args) => {
      // JSON scalar accepts any serializable shape; the return type
      // stays fully typed internally via ExperienceEmbeddingBackfillReport.
      return dispatchExperienceEmbeddingBackfill({
        experienceIds: args.experienceIds
          ? args.experienceIds.map((id) => String(id))
          : undefined,
        bcp47Locales: args.bcp47Locales ?? undefined,
        force: args.force ?? false,
      })
    },
  }),
}))
