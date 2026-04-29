// R3 experience content dump mutation.
//
// `triggerExperienceContentDump` enqueues the useworkflow job that
// dumps cms's Strapi v5 experience corpus into admin's Experience +
// ExperienceLocale tables, then dispatches `runExperienceEmbedding`
// for any locale whose hashable content changed.
//
// ADMIN-only via Pothos scope-auth + the service-layer
// `canWriteDerived` check inside `dumpExperienceLocale`.
//
// The resolver dispatches through `start()` from `workflow/api` —
// not a direct function call. `"use workflow"` functions are
// transformed by the `workflow/next` build plugin so they MUST be
// started via the runtime; calling them directly throws in
// production. See
// docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.

import { start } from "workflow/api"
import { builder } from "@/graphql/builder"
import {
  runExperienceContentDump,
  type ExperienceContentDumpInput,
  type ExperienceContentDumpReport,
} from "@/workflows/experienceContentDump"

/**
 * Dispatch the experience-content-dump workflow via the useworkflow
 * runtime and await the final report. Exported separately from the
 * resolver so dispatch can be asserted without building the Pothos
 * schema in tests (matches R1/R2 dispatch-helper convention).
 */
export async function dispatchExperienceContentDump(
  input: ExperienceContentDumpInput,
): Promise<ExperienceContentDumpReport> {
  const run = await start(runExperienceContentDump, [input])
  return run.returnValue
}

builder.mutationFields((t) => ({
  triggerExperienceContentDump: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:experience-content-dump" },
    description:
      "Enqueue the experience-content-dump workflow. Reads cms's Strapi v5 experiences directly via CMS_DATABASE_URL, transforms each (documentId, locale) into admin's per-locale row + Zod BlockSchema shape, merge-upserts into Experience + ExperienceLocale, and dispatches runExperienceEmbedding for locales whose hashable content changed. ADMIN-only. Reruns are idempotent — repeated invocation against unchanged cms produces zero content writes (only the cms_dumped_at timestamp updates). See docs/plans/2026-04-23-001-feat-admin-r3-experience-migration-plan.md.",
    args: {
      documentIds: t.arg.stringList({
        required: false,
        description:
          "Restrict to these cms Strapi v5 documentIds. Omitted = every cms experience document.",
      }),
      locales: t.arg.stringList({
        required: false,
        description:
          "Restrict to these BCP-47 locales as a pure inclusion filter. Omitted = every locale that exists in cms's experiences corpus, derived at enumeration time. No hardcoded list, no `en` fallback.",
      }),
    },
    resolve: async (_root, args) => {
      // JSON scalar accepts any serializable shape; the return type
      // stays fully typed internally via ExperienceContentDumpReport.
      return dispatchExperienceContentDump({
        documentIds: args.documentIds ?? undefined,
        locales: args.locales ?? undefined,
      })
    },
  }),
}))
