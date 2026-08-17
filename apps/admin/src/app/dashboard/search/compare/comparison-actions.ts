"use server"

import { createHmac } from "node:crypto"

import { redirect } from "next/navigation"
import { z } from "zod"

import { requireAdminSession } from "@/auth/session"
import { env, resolveWatchSearchRuntimeEnv } from "@/config/env"
import { prisma } from "@/db/client"
import { projectWatchSearchComparisonResult } from "@/services/search-trace-privacy"
import { createTypesenseWatchSearchComparisonService } from "@/services/typesense-watch-search-comparison.service"
import { resolveWatchSearchLanguageSelection } from "@/services/watch-search-language-options.service"

const optionalLanguageSelection = z
  .union([z.literal(""), z.string().trim().min(1)])
  .optional()
  .transform((value) => value || undefined)

const ComparisonFormSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    targetLanguageSlug: optionalLanguageSelection,
    languageSelection: optionalLanguageSelection,
    locale: z.string().trim().max(32).optional(),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(10),
    contentType: z.enum(["all", "video", "experience"]).default("all"),
  })
  .strict()
  .superRefine((values, context) => {
    if (
      values.targetLanguageSlug &&
      values.languageSelection &&
      values.targetLanguageSlug !== values.languageSelection
    ) {
      context.addIssue({
        code: "custom",
        path: ["languageSelection"],
        message: "Conflicting language selections",
      })
    }
  })
  .transform(
    ({
      targetLanguageSlug,
      languageSelection,
      locale: _locale,
      ...values
    }) => ({
      ...values,
      selectedLanguageSlug: targetLanguageSlug ?? languageSelection,
    }),
  )

export type WatchSearchComparisonView = ReturnType<
  typeof projectWatchSearchComparisonResult
>

export type WatchSearchComparisonActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; result: WatchSearchComparisonView }

function comparisonEnabled() {
  return resolveWatchSearchRuntimeEnv().candidateComparisonEnabled
}

function comparisonFormValues(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].filter(([key]) => !key.startsWith("$ACTION_")),
  )
}

function actorFingerprint(id: string) {
  return createHmac("sha256", env.ADMIN_SESSION_SECRET)
    .update("watch-search-comparison-actor\0")
    .update(id)
    .digest("hex")
    .slice(0, 32)
}

export async function requireCurrentAdminEvaluator() {
  const principal = await requireAdminSession()
  if (!principal.id) redirect("/dashboard")

  const current = await prisma.user.findUnique({
    where: { id: principal.id },
    select: { id: true, role: true },
  })
  if (current?.role !== "ADMIN") redirect("/dashboard")
  return principal
}

export async function runWatchSearchComparison(
  _previous: WatchSearchComparisonActionState,
  formData: FormData,
): Promise<WatchSearchComparisonActionState> {
  const principal = await requireCurrentAdminEvaluator()
  if (!comparisonEnabled()) {
    return {
      status: "error",
      message: "Candidate comparison is unavailable",
    }
  }

  const parsed = ComparisonFormSchema.safeParse(comparisonFormValues(formData))
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the comparison inputs and try again",
    }
  }

  const values = parsed.data
  const actorKey = actorFingerprint(principal.id!)
  try {
    const languageSelection = values.selectedLanguageSlug
      ? await resolveWatchSearchLanguageSelection(values.selectedLanguageSlug)
      : undefined
    if (values.selectedLanguageSlug && languageSelection === null) {
      return {
        status: "error",
        message: "Check the comparison inputs and try again",
      }
    }
    const comparison =
      await createTypesenseWatchSearchComparisonService().compare({
        actorKey,
        input: {
          query: values.query,
          targetLanguageSlug: languageSelection?.targetLanguageSlug,
          displayLanguageSlug: languageSelection?.targetLanguageSlug,
          acceptLanguage: languageSelection?.locale,
          limit: values.perPage,
          offset: (values.page - 1) * values.perPage,
          resultTypes:
            values.contentType === "all" ? undefined : [values.contentType],
        },
      })
    const projected = projectWatchSearchComparisonResult(comparison)
    const generationId =
      projected.candidate.status === "success"
        ? (projected.candidate.diagnostics.generationId ?? "none")
        : "none"
    console.info(
      `[search] event=candidate_comparison actor_fingerprint=${actorKey} comparison_id=${projected.comparisonId} current_outcome=${projected.current.status} candidate_outcome=${projected.candidate.status} generation_id=${generationId}`,
    )
    return { status: "success", result: projected }
  } catch (error) {
    console.warn(
      `[search] event=candidate_comparison_failed actor_fingerprint=${actorKey} error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
    )
    return {
      status: "error",
      message: "Candidate comparison is temporarily unavailable",
    }
  }
}
