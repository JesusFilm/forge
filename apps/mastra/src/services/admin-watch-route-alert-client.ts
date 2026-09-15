import { z } from "zod"
import { MAX_PUBLIC_WATCH_PATHNAME_LENGTH } from "@forge/watch-url-policy/routes"

import { callAdminSeo } from "./admin-seo-client"

const Id = z.string().trim().min(1).max(191)
const ManifestSchema = z.object({
  version: Id,
  generatedAt: z.string().datetime(),
  contentSlugs: z.array(z.string()),
  oneSegmentSlugs: z.array(z.string()),
  homepageLocales: z.array(z.string()).optional(),
  episodePairsByParent: z.record(z.string(), z.array(z.string())),
  audioLanguageSlugs: z.array(z.string()),
  audioLanguageIndexesByContent: z.record(
    z.string(),
    z.array(z.number().int().nonnegative()),
  ),
  audioLanguageIndexesByEpisode: z.record(
    z.string(),
    z.record(z.string(), z.array(z.number().int().nonnegative())),
  ),
  nestedContainerAudioLanguageIndexesByParent: z
    .record(
      z.string(),
      z.record(z.string(), z.array(z.number().int().nonnegative())),
    )
    .optional(),
})

export type WatchRouteManifest = z.infer<typeof ManifestSchema>

const ClaimInputSchema = z
  .object({
    propertyId: Id,
    origin: z.string().url(),
    contractVersion: z.string().min(1).max(64),
    mode: z.enum(["off", "dry_run", "live"]),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    leaseSeconds: z.number().int().min(30).max(3_600),
    reprobeLimit: z.number().int().min(0).max(25),
  })
  .strict()

const ProbeSchema = z
  .object({
    kind: z.enum(["missing", "healthy_html", "redirect", "inconclusive"]),
    status: z.number().int().min(100).max(599).nullable(),
    probedAt: z.string().datetime(),
    finalUrl: z.string().url().nullable(),
    contentType: z.string().max(191).nullable(),
  })
  .strict()

export type WatchRouteProbe = z.infer<typeof ProbeSchema>

const ObservationSchema = z
  .object({
    path: z.string().min(1).max(MAX_PUBLIC_WATCH_PATHNAME_LENGTH),
    verdict: z.enum(["supported_route_failure", "plausible_missing_route"]),
    count: z.number().int().nonnegative(),
    countKind: z.enum(["event_count", "page_views"]),
    activeUsers: z.number().int().nonnegative(),
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    probe: ProbeSchema,
    evidence: z.unknown(),
  })
  .strict()

export type WatchRouteAlertObservation = z.infer<typeof ObservationSchema>

const LaneReportSchema = z
  .object({
    source: z.enum(["EXPLICIT_EVENT", "LOCALIZED_TITLE"]),
    status: z.enum(["COMPLETE", "PARTIAL", "FAILED"]),
    countKind: z.enum(["EVENT_COUNT", "PAGE_VIEWS"]),
    rowCount: z.number().int().nonnegative(),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    caveats: z.array(z.string().max(500)).max(20),
  })
  .strict()

const RunReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    runKey: z.string().min(1).max(500),
    lanes: z
      .array(LaneReportSchema)
      .length(2)
      .refine(
        (lanes) =>
          new Set(lanes.map(({ source }) => source)).size === 2 &&
          lanes.every(({ source, countKind }) =>
            source === "EXPLICIT_EVENT"
              ? countKind === "EVENT_COUNT"
              : countKind === "PAGE_VIEWS",
          ),
        "Both Watch not-found lanes are required exactly once.",
      ),
    validationCaveats: z.array(z.string().max(500)).max(10),
    candidateTruncatedCount: z.number().int().nonnegative(),
    inconclusiveProbeCount: z.number().int().nonnegative(),
  })
  .strict()

const CompleteInputSchema = z
  .object({
    runId: Id,
    claimGeneration: z.number().int().positive(),
    claimToken: z.string().min(20).max(500),
    status: z.enum(["completed", "partial", "failed"]),
    manifestVersion: Id.nullable(),
    report: RunReportSchema,
    noiseCount: z.number().int().nonnegative(),
    observations: z.array(ObservationSchema).max(25),
    reprobes: z
      .array(
        z
          .object({
            path: z.string().max(MAX_PUBLIC_WATCH_PATHNAME_LENGTH),
            probe: ProbeSchema,
          })
          .strict(),
      )
      .max(25),
  })
  .strict()

const RunSchema = z
  .object({
    id: Id,
    propertyId: Id,
    mode: z.enum(["off", "dry_run", "live"]),
    status: z.enum(["running", "completed", "partial", "failed"]),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict()

const ClaimResultSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        run: RunSchema,
        claim: z
          .object({
            generation: z.number().int().positive(),
            token: z.string().min(20),
            expiresAt: z.string().datetime(),
          })
          .strict()
          .nullable(),
        replayed: z.boolean(),
        openAlerts: z.array(
          z
            .object({
              id: Id,
              path: z.string(),
              lastProbedAt: z.string().datetime().nullable(),
            })
            .strict(),
        ),
        manifest: ManifestSchema.nullable(),
      })
      .strict(),
  })
  .strict()

const CompleteResultSchema = z
  .object({
    ok: z.literal(true),
    result: z.object({ run: RunSchema, replayed: z.boolean() }).strict(),
  })
  .strict()

type ClientOptions = Pick<
  Parameters<typeof callAdminSeo>[0],
  "config" | "fetchImpl" | "resolveHost" | "sign"
>

async function callAdmin<T>(
  payload: unknown,
  schema: z.ZodType<{ ok: true; result: T }>,
  options: ClientOptions,
) {
  const called = await callAdminSeo({
    capability: "watch_alerts",
    path: "/api/seo/watch-route-alerts",
    payload,
    responseSchema: schema,
    ...options,
  })
  return called.ok
    ? ({ ok: true, result: called.result.result } as const)
    : called
}

export function claimWatchRouteAlertRun(
  input: z.input<typeof ClaimInputSchema>,
  options: ClientOptions = {},
) {
  return callAdmin(
    { action: "claim_run", input: ClaimInputSchema.parse(input) },
    ClaimResultSchema,
    options,
  )
}

export function completeWatchRouteAlertRun(
  input: z.input<typeof CompleteInputSchema>,
  options: ClientOptions = {},
) {
  return callAdmin(
    { action: "complete_run", input: CompleteInputSchema.parse(input) },
    CompleteResultSchema,
    options,
  )
}
