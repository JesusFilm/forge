// Consumer-side parity adapter — runs the harness's normalizers + comparator
// over the orchestrated outcome and emits one structured log line per request.
//
// Cross-references:
//   apps/web/src/lib/content-api-mode.ts       (flag deletion list)
//   packages/graphql/src/parity/index.ts:1-34  (harness deletion list)
//
// Deletion checklist (remove together in one PR):
//   - This file + parity-bridge.test.ts
//   - Every callsite of runDualReadComparison (currently zero)
//   - All seven parity log event names from log alerting / dashboards:
//     forge.parity.{diff, admin_timeout, harness_error,
//     strapi_failed_admin_succeeded, both_failed, admin_missing, canary_failed}
//   - FORGE_PARITY_DEBUG env var from deployed env config
//   - @forge/graphql/parity import; the harness directory can retire too
//     once nothing else consumes it

import {
  AdminBlocksValidationError,
  AdminNormalizationError,
  StrapiNormalizationError,
  compareNormalizedRoutes,
  normalizeAdmin,
  normalizeStrapi,
  type StrapiBlockInput,
  type StrapiExperienceInput,
  type AdminExperienceLocaleInput,
} from "@forge/graphql/parity"
import { env } from "@/env"
import { getContentApiMode } from "@/lib/content-api-mode"

// `"dual-read"` is no longer in the typed ContentApiMode union, so this
// guard returns false in production — kills canary emission across the
// board so operators don't have to disambiguate real admin failures from
// leftover canary noise. Explicit string cast documents the dead branch
// is deliberate.
function isCanaryEmissionEnabled(): boolean {
  return (getContentApiMode() as string) === "dual-read"
}

export const PARITY_LOG_EVENTS = [
  "forge.parity.diff",
  "forge.parity.admin_timeout",
  "forge.parity.harness_error",
  "forge.parity.strapi_failed_admin_succeeded",
  "forge.parity.both_failed",
  // Both fetched OK but admin returned null — typical during backfill.
  // Distinct from harness_error so dashboards can split legitimate-gap
  // from real comparator failures.
  "forge.parity.admin_missing",
  // The bridge itself threw (circular ref in payload, throwing toString).
  // User render unaffected — Strapi already returned.
  "forge.parity.canary_failed",
] as const
type ParityLogEvent = (typeof PARITY_LOG_EVENTS)[number]

const PARITY_ROUTE = "[slug]" as const

type HarnessErrorSubkind =
  | "admin_fetch_error"
  | "admin_blocks_validation"
  | "admin_normalization"
  | "strapi_normalization"
  | "comparator_unknown"

type SideOutcome<T> =
  | { readonly ok: true; readonly response: T; readonly durationMs: number }
  | {
      readonly ok: "error"
      readonly error: unknown
      readonly durationMs: number
    }
  | { readonly ok: "timeout"; readonly durationMs: number }

type StrapiExperienceResponse = {
  readonly documentId?: string | null
  readonly slug?: string | null
  readonly locale?: string | null
  readonly title?: string | null
  readonly metaDescription?: string | null
  readonly ogImage?: {
    readonly url?: string | null
    readonly width?: number | null
    readonly height?: number | null
    readonly alternativeText?: string | null
  } | null
  readonly blocks?: ReadonlyArray<unknown> | null
}

// Note: admin schema's `metaDescription` is remapped to `description` in
// `adaptAdmin` before invoking `normalizeAdmin`.
type AdminExperienceResponse = {
  readonly id?: string | null
  readonly slug?: string | null
  readonly locale?: string | null
  readonly title?: string | null
  readonly metaDescription?: string | null
  readonly ogImageUrl?: string | null
  readonly blocks?: unknown
}

export type DualReadOutcome = {
  readonly slug: string
  readonly urlLocale: string
  readonly strapi: SideOutcome<StrapiExperienceResponse | null | undefined>
  readonly admin: SideOutcome<AdminExperienceResponse | null | undefined>
}

// SECURITY: production payload NEVER carries raw diff values (titles,
// descriptions, URLs) — those would bypass CMS access control if indexed
// by Vercel/Railway log search. Only paths + counts reach prod; full
// DiffReport is dev-opt-in via FORGE_PARITY_DEBUG=1.
type ParityLogPayload = {
  readonly event: ParityLogEvent
  readonly route: typeof PARITY_ROUTE
  readonly slug: string
  readonly locale: string
  readonly timings: {
    readonly strapiMs: number | null
    readonly adminMs: number | null
  }
  readonly diffCounts?: {
    readonly structural: number
    readonly value: number
    readonly order: number
    readonly semantic: number
    readonly potentiallyTruncated: number
  }
  readonly diffPaths?: ReadonlyArray<string>
  readonly allowListedHits?: number
  readonly subkind?: HarnessErrorSubkind
  readonly errorMessage?: string
  /** Dev-only opt-in (FORGE_PARITY_DEBUG=1). Never set in production. */
  readonly diffSamples?: ReadonlyArray<{
    readonly channel: string
    readonly path: string
    readonly strapi: unknown
    readonly admin: unknown
  }>
}

/**
 * Routes the orchestrated outcome to one parity log event. Never re-throws —
 * harness errors are caught and routed to `forge.parity.harness_error`.
 * Short-circuits when not in `dual-read` mode (currently always — see above).
 */
export function runDualReadComparison(outcome: DualReadOutcome): void {
  if (!isCanaryEmissionEnabled()) return

  const baseTimings = {
    strapiMs: outcome.strapi.durationMs,
    adminMs: outcome.admin.durationMs,
  }

  // Both failed — propagate user-side via Strapi error (orchestrator's job);
  // log the asymmetric outcome here.
  if (outcome.strapi.ok !== true && outcome.admin.ok !== true) {
    emit({
      event: "forge.parity.both_failed",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      errorMessage: extractErrorMessage(outcome.strapi),
    })
    return
  }

  // Strapi failed, admin succeeded — gating signal for U5b advance.
  if (outcome.strapi.ok !== true && outcome.admin.ok === true) {
    emit({
      event: "forge.parity.strapi_failed_admin_succeeded",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      errorMessage: extractErrorMessage(outcome.strapi),
    })
    return
  }

  // Strapi succeeded, admin timed out — bound the admin tail.
  if (outcome.strapi.ok === true && outcome.admin.ok === "timeout") {
    emit({
      event: "forge.parity.admin_timeout",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
    })
    return
  }

  // Strapi succeeded, admin errored (non-timeout) — admin fetch failed.
  if (outcome.strapi.ok === true && outcome.admin.ok === "error") {
    emit({
      event: "forge.parity.harness_error",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      subkind: "admin_fetch_error",
      errorMessage: extractErrorMessage(outcome.admin),
    })
    return
  }

  // Both succeeded — run the differ. Type narrowing for TS.
  if (outcome.strapi.ok !== true || outcome.admin.ok !== true) return

  const strapiResponse = outcome.strapi.response
  const adminResponse = outcome.admin.response

  // Null-response signals:
  //   admin null + Strapi data → admin_missing (typical during backfill;
  //     gating metric for advancing to admin-mode rendering)
  //   both null OR Strapi null + admin data → comparator_unknown
  if (!strapiResponse && !adminResponse) {
    emit({
      event: "forge.parity.harness_error",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      subkind: "comparator_unknown",
      errorMessage: "both responses were null/undefined",
    })
    return
  }
  if (strapiResponse && !adminResponse) {
    emit({
      event: "forge.parity.admin_missing",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
    })
    return
  }
  if (!strapiResponse && adminResponse) {
    emit({
      event: "forge.parity.harness_error",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      subkind: "comparator_unknown",
      errorMessage: "strapi response was null/undefined while admin succeeded",
    })
    return
  }
  if (!strapiResponse || !adminResponse) return

  try {
    const strapiInput = adaptStrapi(strapiResponse, outcome.urlLocale)
    const adminInput = adaptAdmin(adminResponse)

    const baseOrigin = env.NEXT_PUBLIC_CANONICAL_ORIGIN

    const strapiNormalized = normalizeStrapi(strapiInput, {
      urlLocale: outcome.urlLocale,
      baseOrigin,
    })
    const adminNormalized = normalizeAdmin(adminInput, {
      urlLocale: outcome.urlLocale,
      baseOrigin,
    })

    const report = compareNormalizedRoutes(strapiNormalized, adminNormalized, {
      urlLocale: outcome.urlLocale,
    })

    const diffPaths = collectDiffPaths(report)
    // SECURITY: dev opt-in requires BOTH the flag AND non-prod NODE_ENV, so
    // a typo'd flag in prod env is a no-op. NODE_ENV stays on process.env
    // (Next inlines it); FORGE_PARITY_DEBUG via typed env so z.enum runs.
    const debugEnabled =
      process.env.NODE_ENV !== "production" && env.FORGE_PARITY_DEBUG === "1"

    emit({
      event: "forge.parity.diff",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      diffCounts: {
        structural: report.structural.length,
        value: report.value.length,
        order: report.order.length,
        semantic: report.semantic.length,
        potentiallyTruncated: report.potentiallyTruncated.length,
      },
      diffPaths,
      allowListedHits: report.meta.appliedAllowList.length,
      ...(debugEnabled
        ? { diffSamples: collectDiffSamples(report).slice(0, 3) }
        : {}),
    })
  } catch (error) {
    emit({
      event: "forge.parity.harness_error",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      subkind: classifyHarnessError(error),
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

// Input adaptation

/** Synthesizes `locale` from URL when the Strapi fragment hasn't selected it. */
function adaptStrapi(
  response: StrapiExperienceResponse,
  urlLocale: string,
): StrapiExperienceInput {
  return {
    documentId: response.documentId ?? "",
    slug: response.slug ?? "",
    locale: response.locale ?? urlLocale,
    title: response.title ?? "",
    metaDescription: response.metaDescription,
    ogImage: response.ogImage
      ? {
          url: response.ogImage.url ?? "",
          width: response.ogImage.width ?? null,
          height: response.ogImage.height ?? null,
          alternativeText: response.ogImage.alternativeText ?? null,
        }
      : null,
    blocks: (response.blocks as ReadonlyArray<StrapiBlockInput>) ?? null,
  }
}

/** Single semantic delta: `metaDescription → description` for the harness. */
function adaptAdmin(
  response: AdminExperienceResponse,
): AdminExperienceLocaleInput {
  // Blocks cast is safe under the harness's BlocksSchema.safeParse.
  return {
    id: response.id ?? "",
    slug: response.slug ?? "",
    locale: response.locale ?? "",
    title: response.title ?? "",
    description: response.metaDescription,
    ogImageUrl: response.ogImageUrl,
    blocks: response.blocks as AdminExperienceLocaleInput["blocks"],
  }
}

// Helpers

function emit(payload: ParityLogPayload): void {
  if (typeof console === "undefined") return
  console.log(JSON.stringify(payload))
}

function extractErrorMessage(side: SideOutcome<unknown>): string | undefined {
  if (side.ok === "error") {
    return side.error instanceof Error ? side.error.message : String(side.error)
  }
  if (side.ok === "timeout") return "timed out"
  return undefined
}

function classifyHarnessError(error: unknown): HarnessErrorSubkind {
  if (error instanceof AdminBlocksValidationError)
    return "admin_blocks_validation"
  if (error instanceof AdminNormalizationError) return "admin_normalization"
  if (error instanceof StrapiNormalizationError) return "strapi_normalization"
  return "comparator_unknown"
}

function collectDiffPaths(report: {
  structural: ReadonlyArray<{ path: string }>
  value: ReadonlyArray<{ path: string }>
  order: ReadonlyArray<{ path: string }>
  semantic: ReadonlyArray<{ path: string }>
  potentiallyTruncated: ReadonlyArray<{ path: string }>
}): ReadonlyArray<string> {
  const all = [
    ...report.structural.map((d) => d.path),
    ...report.value.map((d) => d.path),
    ...report.order.map((d) => d.path),
    ...report.semantic.map((d) => d.path),
    ...report.potentiallyTruncated.map((d) => d.path),
  ]
  return Array.from(new Set(all)).sort()
}

function collectDiffSamples(report: {
  value: ReadonlyArray<{ path: string; strapi: unknown; admin: unknown }>
  semantic: ReadonlyArray<{ path: string; strapi: unknown; admin: unknown }>
}): ReadonlyArray<{
  channel: string
  path: string
  strapi: unknown
  admin: unknown
}> {
  return [
    ...report.value.map((d) => ({
      channel: "value" as const,
      path: d.path,
      strapi: d.strapi,
      admin: d.admin,
    })),
    ...report.semantic.map((d) => ({
      channel: "semantic" as const,
      path: d.path,
      strapi: d.strapi,
      admin: d.admin,
    })),
  ]
}
