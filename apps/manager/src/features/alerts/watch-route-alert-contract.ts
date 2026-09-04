import { z } from "zod"
import { MAX_PUBLIC_WATCH_PATHNAME_LENGTH } from "@forge/watch-url-policy/routes"

export const watchRouteAlertLaneSchema = z
  .object({
    source: z.enum(["EXPLICIT_EVENT", "LOCALIZED_TITLE"]),
    status: z.enum(["COMPLETE", "PARTIAL", "FAILED"]),
    countKind: z.enum(["EVENT_COUNT", "PAGE_VIEWS"]),
    rowCount: z.number().int().nonnegative(),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    caveats: z.array(z.string()).max(20),
  })
  .strict()

const watchRouteAlertRunSchema = z
  .object({
    id: z.string().min(1),
    propertyId: z.string().min(1),
    mode: z.enum(["OFF", "DRY_RUN", "LIVE"]),
    status: z.enum(["RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    lanes: z.array(watchRouteAlertLaneSchema).max(2),
    validationCaveats: z.array(z.string().max(500)).max(10),
  })
  .strict()

export const watchRouteAlertItemSchema = z
  .object({
    id: z.string().min(1),
    propertyId: z.string().min(1),
    origin: z.string().url(),
    path: z
      .string()
      .max(MAX_PUBLIC_WATCH_PATHNAME_LENGTH)
      .startsWith("/watch/"),
    lifecycle: z.enum(["OPEN", "RECOVERED"]),
    verdict: z.enum(["SUPPORTED_ROUTE_FAILURE", "PLAUSIBLE_MISSING_ROUTE"]),
    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM"]),
    count: z.number().int().nonnegative(),
    countKind: z.enum(["EVENT_COUNT", "PAGE_VIEWS"]),
    activeUsers: z.number().int().nonnegative(),
    occurrenceCount: z.number().int().nonnegative(),
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    lastProbedAt: z.string().datetime().nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    manifestVersion: z.string().min(1),
    sources: z.array(z.enum(["EXPLICIT_EVENT", "LOCALIZED_TITLE"])).max(2),
  })
  .strict()

export const watchRouteAlertsPageSchema = z
  .object({
    generatedAt: z.string().datetime(),
    monitorState: z.enum(["NEVER_RUN", "HEALTHY", "PARTIAL", "UNAVAILABLE"]),
    recoverySuppressed: z.boolean(),
    lastSuccessfulAt: z.string().datetime().nullable(),
    latestRun: watchRouteAlertRunSchema.nullable(),
    propertyRuns: z.array(watchRouteAlertRunSchema).max(100),
    propertyRunsTruncated: z.boolean(),
    summary: z
      .object({
        open: z.number().int().nonnegative(),
        critical: z.number().int().nonnegative(),
        supportedRouteFailures: z.number().int().nonnegative(),
        plausibleMissingRoutes: z.number().int().nonnegative(),
        recovered: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(watchRouteAlertItemSchema).max(100),
    totalCount: z.number().int().nonnegative(),
    showing: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict()

export type WatchRouteAlertsPage = z.infer<typeof watchRouteAlertsPageSchema>
export type WatchRouteAlertItem = z.infer<typeof watchRouteAlertItemSchema>
