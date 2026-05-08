// =============================================================================
// U5 (feat-104 consumer migration) — parity bridge
//
// Consumer-side adapter that takes the orchestrated outcome of a
// Strapi + admin parallel fetch (from fetchSlugExperience in
// content.ts), runs the U4 harness's normalizers + comparator, and
// emits a single structured log line per request.
//
// Cross-references:
//   apps/web/src/lib/content-api-mode.ts       (U1 — flag deletion list)
//   packages/graphql/src/parity/index.ts:1-34  (harness deletion list)
//   docs/plans/2026-05-08-001-feat-consumer-migration-web-canary-unit-5-plan.md
//
// At retirement, remove ALL of the following in one PR:
//
//   - This file: apps/web/src/lib/parity-bridge.ts
//   - The companion test: apps/web/src/lib/parity-bridge.test.ts
//   - Every callsite of `runDualReadComparison` in content.ts
//   - All five parity log event names from any log alerting / dashboards
//     (forge.parity.diff, forge.parity.admin_timeout,
//      forge.parity.harness_error, forge.parity.strapi_failed_admin_succeeded,
//      forge.parity.both_failed)
//   - The FORGE_PARITY_DEBUG env var from any deployed env config
//   - The `@forge/graphql/parity` package import — once nothing else
//     consumes it, the harness directory can also retire
//
// =============================================================================

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

/**
 * Closed union of every parity log event ce-work emits. Exporting the
 * union as `as const`-derived type lets callers type-check event names
 * at compile time. Adding a new event requires updating this list AND
 * the deletion checklist above.
 */
export const PARITY_LOG_EVENTS = [
  "forge.parity.diff",
  "forge.parity.admin_timeout",
  "forge.parity.harness_error",
  "forge.parity.strapi_failed_admin_succeeded",
  "forge.parity.both_failed",
] as const
export type ParityLogEvent = (typeof PARITY_LOG_EVENTS)[number]

/**
 * Stable route discriminator for the parity log payload. Hard-coded to
 * "[slug]" because U5's canary surface is the slug-page Experience
 * branch only. Future units that add other route surfaces (homepage,
 * /watch/[collection]/[video]/[locale]) will introduce their own
 * route literals.
 */
const PARITY_ROUTE = "[slug]" as const

/**
 * Subkind discriminator for `harness_error` events. Tells the operator
 * which boundary surfaced the error (admin fetch, admin parse, Strapi
 * parse, or generic comparator failure).
 */
export type HarnessErrorSubkind =
  | "admin_fetch_error"
  | "admin_blocks_validation"
  | "admin_normalization"
  | "strapi_normalization"
  | "comparator_unknown"

/**
 * Outcome shape per source. The orchestrator (content.ts) wraps each
 * fetch with try/catch + Promise.race timeout and hands the bridge the
 * resulting tagged union.
 */
export type SideOutcome<T> =
  | { readonly ok: true; readonly response: T; readonly durationMs: number }
  | {
      readonly ok: "error"
      readonly error: unknown
      readonly durationMs: number
    }
  | { readonly ok: "timeout"; readonly durationMs: number }

/**
 * Loose Strapi response shape — matches what `WatchExperience` selects
 * from `GET_WATCH_EXPERIENCE`. The bridge picks the harness-required
 * fields off this and synthesizes missing ones (notably `locale`,
 * which the existing fragment may not select).
 */
export type StrapiExperienceResponse = {
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

/**
 * Loose admin response shape — matches `experienceBySlug` returning
 * `ExperienceLocale | null`. Note `metaDescription` is the admin schema
 * field name; the bridge remaps to `description` before invoking
 * `normalizeAdmin` (which consumes `description`, NOT `metaDescription`).
 */
export type AdminExperienceResponse = {
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

/**
 * Production log payload. NEVER carries raw `ValueDiff.strapi` or
 * `SemanticDiff.admin` field values from the harness's `DiffReport` —
 * those are content fields (titles, descriptions, URLs) that would
 * bypass CMS access control if indexed by Vercel/Railway log search.
 *
 * Only `paths` (RFC6901 JSON Pointers) and per-channel `counts` reach
 * production logs. The full `DiffReport` (with values) is opt-in for
 * dev under `FORGE_PARITY_DEBUG=1`; production strips unconditionally.
 */
export type ParityLogPayload = {
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
 * Bridge entry. Inspects the orchestrated outcome, routes to the
 * appropriate log event, and emits a single `console.log(JSON.stringify(...))`
 * line. Never re-throws — all harness errors are caught and routed to
 * `forge.parity.harness_error`.
 */
export function runDualReadComparison(outcome: DualReadOutcome): void {
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

  // Either response can be null when the slug doesn't exist on that side.
  // Treat null as a structural absence for now; the harness expects a
  // populated input. If either is missing, log harness_error subkind
  // `comparator_unknown` rather than feeding the normalizers garbage.
  if (!strapiResponse || !adminResponse) {
    emit({
      event: "forge.parity.harness_error",
      route: PARITY_ROUTE,
      slug: outcome.slug,
      locale: outcome.urlLocale,
      timings: baseTimings,
      subkind: "comparator_unknown",
      errorMessage: !strapiResponse
        ? "strapi response was null/undefined"
        : "admin response was null/undefined",
    })
    return
  }

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
    const debugEnabled = process.env.FORGE_PARITY_DEBUG === "1"

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

// ---------------------------------------------------------------------------
// Input adaptation
// ---------------------------------------------------------------------------

/**
 * Adapt the Strapi `WatchExperience` shape to the harness's
 * `StrapiExperienceInput` shape. Synthesizes `locale` from the URL
 * locale if the response lacks it (defense-in-depth for fragments
 * that haven't yet added `locale` to their selection set).
 */
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

/**
 * Adapt the admin `experienceBySlug` shape to the harness's
 * `AdminExperienceLocaleInput` shape. The single semantic delta is
 * `metaDescription → description` — admin's schema field is
 * `metaDescription` but the harness consumes `description`.
 */
function adaptAdmin(
  response: AdminExperienceResponse,
): AdminExperienceLocaleInput {
  return {
    id: response.id ?? "",
    slug: response.slug ?? "",
    locale: response.locale ?? "",
    title: response.title ?? "",
    description: response.metaDescription,
    ogImageUrl: response.ogImageUrl,
    blocks: response.blocks,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
