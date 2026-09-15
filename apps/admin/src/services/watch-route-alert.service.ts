import { createHash, randomUUID } from "node:crypto"

import {
  Prisma,
  type PrismaClient,
  type WatchRouteAlertAutomationMode,
  type WatchRouteAlertCountKind,
  type WatchRouteAlertRunStatus,
  type WatchRouteAlertVerdict,
} from "@prisma/client"
import {
  classifyPublicWatchPathname,
  MAX_PUBLIC_WATCH_PATHNAME_LENGTH,
  PUBLIC_WATCH_ORIGIN,
} from "@forge/watch-url-policy/routes"
import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { consumeSeoWorkloadAssertion } from "@/auth/seo-assertion-ledger"
import type { VerifiedSeoWorkloadAssertion } from "@/auth/seo-service-assertion"
import { ForbiddenError } from "@/services/errors"

const Id = z.string().trim().min(1).max(191)
const IsoDate = z.string().datetime({ offset: true })
const JsonInput = z.unknown()
const RUN_DETAIL_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
const EPISODE_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000
const RETENTION_BATCH = 500
const MANAGER_PROPERTY_RUN_LIMIT = 100

export const WatchRouteAlertClaimInput = z
  .object({
    propertyId: Id,
    origin: z.string().url().max(255),
    contractVersion: z.string().trim().min(1).max(64),
    mode: z.enum(["off", "dry_run", "live"]),
    windowStart: IsoDate,
    windowEnd: IsoDate,
    leaseSeconds: z.number().int().min(30).max(3_600).default(300),
    reprobeLimit: z.number().int().min(0).max(25).default(25),
  })
  .strict()

const ProbeInput = z
  .object({
    kind: z.enum(["missing", "healthy_html", "redirect", "inconclusive"]),
    status: z.number().int().min(100).max(599).nullable(),
    probedAt: IsoDate,
    finalUrl: z.string().url().max(2_000).nullable().default(null),
    contentType: z.string().max(191).nullable().default(null),
  })
  .strict()

const ObservationInput = z
  .object({
    path: z.string().min(1).max(MAX_PUBLIC_WATCH_PATHNAME_LENGTH),
    verdict: z.enum(["supported_route_failure", "plausible_missing_route"]),
    count: z.number().int().nonnegative(),
    countKind: z.enum(["event_count", "page_views"]),
    activeUsers: z.number().int().nonnegative(),
    firstSeenAt: IsoDate,
    lastSeenAt: IsoDate,
    probe: ProbeInput,
    evidence: JsonInput,
  })
  .strict()

const LaneReport = z
  .object({
    source: z.enum(["EXPLICIT_EVENT", "LOCALIZED_TITLE"]),
    status: z.enum(["COMPLETE", "PARTIAL", "FAILED"]),
    countKind: z.enum(["EVENT_COUNT", "PAGE_VIEWS"]),
    rowCount: z.number().int().nonnegative(),
    windowStart: IsoDate,
    windowEnd: IsoDate,
    caveats: z.array(z.string().max(500)).max(20),
  })
  .strict()

const RunReport = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: IsoDate,
    runKey: z.string().min(1).max(500),
    lanes: z
      .array(LaneReport)
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

export const WatchRouteAlertCompleteInput = z
  .object({
    runId: Id,
    claimGeneration: z.number().int().positive(),
    claimToken: z.string().min(20).max(500),
    status: z.enum(["completed", "partial", "failed"]),
    manifestVersion: Id.nullable(),
    report: RunReport,
    noiseCount: z.number().int().nonnegative(),
    observations: z.array(ObservationInput).max(25),
    reprobes: z
      .array(
        z
          .object({
            path: z.string().min(1).max(MAX_PUBLIC_WATCH_PATHNAME_LENGTH),
            probe: ProbeInput,
          })
          .strict(),
      )
      .max(25),
  })
  .strict()

type DbClient = PrismaClient | Prisma.TransactionClient

export class WatchRouteAlertConflictError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "WatchRouteAlertConflictError"
  }
}

type ClaimInput = z.infer<typeof WatchRouteAlertClaimInput>
type CompleteInput = z.infer<typeof WatchRouteAlertCompleteInput>
type Observation = z.infer<typeof ObservationInput>

const AUTOMATION_MODE_BY_INPUT = {
  off: "OFF",
  dry_run: "DRY_RUN",
  live: "LIVE",
} as const satisfies Record<ClaimInput["mode"], WatchRouteAlertAutomationMode>

const RUN_STATUS_BY_INPUT = {
  completed: "COMPLETED",
  partial: "PARTIAL",
  failed: "FAILED",
} as const satisfies Record<CompleteInput["status"], WatchRouteAlertRunStatus>

const COUNT_KIND_BY_INPUT = {
  event_count: "EVENT_COUNT",
  page_views: "PAGE_VIEWS",
} as const satisfies Record<Observation["countKind"], WatchRouteAlertCountKind>

const VERDICT_BY_INPUT = {
  supported_route_failure: "SUPPORTED_ROUTE_FAILURE",
  plausible_missing_route: "PLAUSIBLE_MISSING_ROUTE",
} as const satisfies Record<Observation["verdict"], WatchRouteAlertVerdict>

function plusMs(value: Date, milliseconds: number) {
  return new Date(value.getTime() + milliseconds)
}

function bootstrapWindowStart(windowEnd: Date) {
  const start = new Date(windowEnd)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - 6)
  return start
}

function overlapWindowStart(lastCompleteWindowEnd: Date) {
  const start = new Date(lastCompleteWindowEnd)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - 1)
  return start
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function encodeAlertCursor(id: string) {
  return Buffer.from(JSON.stringify({ v: 1, id }), "utf8").toString("base64url")
}

function decodeAlertCursor(value: string | null | undefined) {
  if (!value) return undefined
  if (value.length > 512) {
    throw new WatchRouteAlertConflictError("invalid_alert_cursor")
  }
  try {
    const parsed = z
      .object({ v: z.literal(1), id: Id })
      .strict()
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
    return parsed.id
  } catch {
    throw new WatchRouteAlertConflictError("invalid_alert_cursor")
  }
}

function canonicalOrigin(raw: string) {
  const url = new URL(raw)
  if (
    url.origin !== PUBLIC_WATCH_ORIGIN ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new WatchRouteAlertConflictError("invalid_property_origin")
  }
  return url.origin
}

export function normalizeWatchRouteAlertPath(raw: string, origin: string) {
  if (
    /[%\\]/u.test(raw) ||
    Array.from(raw).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    throw new WatchRouteAlertConflictError("invalid_watch_path")
  }
  let url: URL
  try {
    url = new URL(raw, `${origin}/`)
  } catch {
    throw new WatchRouteAlertConflictError("invalid_watch_path")
  }
  if (url.origin !== origin || url.username || url.password || url.port) {
    throw new WatchRouteAlertConflictError("off_origin_path")
  }
  const classification = classifyPublicWatchPathname(url.pathname)
  if (
    classification.kind !== "page" ||
    !classification.normalizedPathname.startsWith("/watch/")
  ) {
    throw new WatchRouteAlertConflictError("invalid_watch_path")
  }
  return classification.normalizedPathname
}

function sanitizeText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"']+/giu, (raw) => {
      try {
        const url = new URL(raw)
        return `${url.origin}${url.pathname}`
      } catch {
        return "[redacted-url]"
      }
    })
    .slice(0, 500)
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]"
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") return sanitizeText(value)
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeJson(item, depth + 1))
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [
          key.slice(0, 100),
          /authorization|cookie|token|secret|password|client.?ip|ip.?address/iu.test(
            key,
          )
            ? "[redacted]"
            : sanitizeJson(item, depth + 1),
        ]),
    )
  }
  return String(value).slice(0, 500)
}

function boundedJson(value: unknown): Prisma.InputJsonValue {
  const sanitized = sanitizeJson(value)
  const bytes = Buffer.byteLength(JSON.stringify(sanitized), "utf8")
  return (
    bytes <= 64 * 1024
      ? sanitized
      : {
          schemaVersion: 1,
          detailState: "truncated",
          originalBytes: bytes,
        }
  ) as Prisma.InputJsonValue
}

function reportLanes(value: unknown) {
  const parsed = RunReport.safeParse(value)
  return parsed.success ? parsed.data.lanes : []
}

function reportValidationCaveats(value: unknown) {
  const parsed = RunReport.safeParse(value)
  return parsed.success ? parsed.data.validationCaveats : []
}

function statusForReport(report: z.infer<typeof RunReport>) {
  if (report.lanes.every(({ status }) => status === "FAILED")) return "failed"
  if (
    report.lanes.some(({ status }) => status !== "COMPLETE") ||
    report.validationCaveats.length > 0
  ) {
    return "partial"
  }
  return "completed"
}

function monitorStateFor(
  latestRun: { mode: string; status: string } | null,
  lanes: z.infer<typeof LaneReport>[],
) {
  if (!latestRun) return "NEVER_RUN"
  if (
    latestRun.status === "FAILED" ||
    (latestRun.mode === "LIVE" &&
      latestRun.status === "COMPLETED" &&
      lanes.length === 0)
  ) {
    return "UNAVAILABLE"
  }
  if (
    latestRun.mode !== "LIVE" ||
    latestRun.status !== "COMPLETED" ||
    lanes.length !== 2 ||
    lanes.some((lane) => lane.status !== "COMPLETE")
  ) {
    return "PARTIAL"
  }
  return "HEALTHY"
}

function evidenceSources(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const parsed = z
    .array(z.enum(["EXPLICIT_EVENT", "LOCALIZED_TITLE"]))
    .max(2)
    .safeParse((value as Record<string, unknown>).sources)
  return parsed.success ? parsed.data : []
}

function severity(
  verdict: z.infer<typeof ObservationInput>["verdict"],
  count: number,
) {
  if (verdict === "supported_route_failure") {
    return count >= 50 ? "CRITICAL" : "HIGH"
  }
  return "MEDIUM"
}

function healthyHtmlProbe(probe: z.infer<typeof ProbeInput>, origin: string) {
  if (
    probe.kind !== "healthy_html" ||
    probe.status === null ||
    probe.status < 200 ||
    probe.status >= 300 ||
    !probe.contentType?.toLowerCase().startsWith("text/html") ||
    !probe.finalUrl
  ) {
    return false
  }
  try {
    return new URL(probe.finalUrl).origin === origin
  } catch {
    return false
  }
}

async function applyRetention(tx: DbClient, now: Date) {
  const expiredObservations = await tx.watchRouteAlertDailyObservation.findMany(
    {
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: RETENTION_BATCH,
      select: { id: true },
    },
  )
  if (expiredObservations.length) {
    await tx.watchRouteAlertDailyObservation.deleteMany({
      where: { id: { in: expiredObservations.map(({ id }) => id) } },
    })
  }

  const expiredRuns = await tx.watchRouteAlertRun.findMany({
    where: { detailExpiresAt: { lte: now }, detailExpiredAt: null },
    orderBy: [{ detailExpiresAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  })
  if (expiredRuns.length) {
    await tx.watchRouteAlertRun.updateMany({
      where: { id: { in: expiredRuns.map(({ id }) => id) } },
      data: {
        report: { schemaVersion: 1, detailState: "detail_expired" },
        detailExpiredAt: now,
      },
    })
  }

  const expiredEpisodes = await tx.watchRouteAlertEpisode.findMany({
    where: {
      recoveredAt: { lte: plusMs(now, -EPISODE_RETENTION_MS) },
      detailExpiresAt: { lte: now },
    },
    orderBy: [{ detailExpiresAt: "asc" }, { id: "asc" }],
    take: RETENTION_BATCH,
    select: { id: true },
  })
  if (expiredEpisodes.length) {
    await tx.watchRouteAlertEpisode.deleteMany({
      where: { id: { in: expiredEpisodes.map(({ id }) => id) } },
    })
  }
}

export class WatchRouteAlertService {
  constructor(private readonly prisma: PrismaClient) {}

  async claimRun({
    assertion,
    input: rawInput,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: z.infer<typeof WatchRouteAlertClaimInput>
  }) {
    const input = WatchRouteAlertClaimInput.parse(rawInput)
    const origin = canonicalOrigin(input.origin)
    const requestedWindowStart = new Date(input.windowStart)
    const windowEnd = new Date(input.windowEnd)
    if (windowEnd < requestedWindowStart) {
      throw new WatchRouteAlertConflictError("invalid_reporting_window")
    }

    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date()
        await consumeSeoWorkloadAssertion(tx, assertion)
        await applyRetention(tx, now)
        const progress = await tx.watchRouteAlertPropertyProgress.findUnique({
          where: { propertyId: input.propertyId },
        })
        // A retry for the same completed window must resolve to the original
        // bootstrap key instead of creating a second, shorter overlap run.
        const windowStart =
          progress?.lastCompleteWindowEnd.getTime() === windowEnd.getTime()
            ? progress.lastCompleteWindowStart
            : progress
              ? new Date(
                  Math.min(
                    requestedWindowStart.getTime(),
                    overlapWindowStart(
                      progress.lastCompleteWindowEnd,
                    ).getTime(),
                  ),
                )
              : bootstrapWindowStart(windowEnd)
        const idempotencyKey = hash(
          [
            input.mode,
            input.propertyId,
            windowStart.toISOString(),
            windowEnd.toISOString(),
            input.contractVersion,
          ].join("\n"),
        )
        const createdId = randomUUID()
        const token = randomUUID()
        const tokenHash = hash(token)
        const expiresAt = plusMs(now, input.leaseSeconds * 1_000)
        // Serialize live work per property. The transaction is Serializable so
        // two different reporting windows cannot both acquire a valid fence.
        const conflictingActiveRun =
          input.mode === "live"
            ? await tx.watchRouteAlertRun.findFirst({
                where: {
                  propertyId: input.propertyId,
                  mode: "LIVE",
                  status: "RUNNING",
                  idempotencyKey: { not: idempotencyKey },
                  executionClaimExpiresAt: { gt: now },
                },
                orderBy: [{ startedAt: "asc" }, { id: "asc" }],
              })
            : null
        let run =
          conflictingActiveRun ??
          (await tx.watchRouteAlertRun.upsert({
            where: { idempotencyKey },
            update: {},
            create: {
              id: createdId,
              idempotencyKey,
              propertyId: input.propertyId,
              origin,
              contractVersion: input.contractVersion,
              mode: AUTOMATION_MODE_BY_INPUT[input.mode],
              status: input.mode === "off" ? "COMPLETED" : "RUNNING",
              windowStart,
              windowEnd,
              detailExpiresAt: plusMs(now, RUN_DETAIL_RETENTION_MS),
              ...(input.mode === "off"
                ? {
                    completedAt: now,
                    report: { schemaVersion: 1, mode: "off" },
                  }
                : {
                    executionFenceGeneration: 1,
                    executionClaimTokenHash: tokenHash,
                    executionClaimExpiresAt: expiresAt,
                  }),
            },
          }))
        let claim =
          !conflictingActiveRun && run.id === createdId && input.mode !== "off"
            ? { generation: 1, token, expiresAt: expiresAt.toISOString() }
            : null
        let replayed = conflictingActiveRun != null || run.id !== createdId
        if (
          replayed &&
          run.status === "RUNNING" &&
          (!run.executionClaimExpiresAt || run.executionClaimExpiresAt <= now)
        ) {
          const reclaimed = await tx.watchRouteAlertRun.updateMany({
            where: {
              id: run.id,
              status: "RUNNING",
              OR: [
                { executionClaimExpiresAt: null },
                { executionClaimExpiresAt: { lte: now } },
              ],
            },
            data: {
              executionFenceGeneration: { increment: 1 },
              executionClaimTokenHash: tokenHash,
              executionClaimExpiresAt: expiresAt,
            },
          })
          if (reclaimed.count === 1) {
            run = await tx.watchRouteAlertRun.findUniqueOrThrow({
              where: { id: run.id },
            })
            claim = {
              generation: run.executionFenceGeneration,
              token,
              expiresAt: expiresAt.toISOString(),
            }
            replayed = false
          }
        }
        const openAlerts = await tx.watchRouteAlert.findMany({
          where: { propertyId: input.propertyId, lifecycle: "OPEN" },
          orderBy: [
            { lastProbedAt: { sort: "asc", nulls: "first" } },
            { id: "asc" },
          ],
          take: input.reprobeLimit,
          select: { id: true, normalizedPath: true, lastProbedAt: true },
        })
        return {
          run: this.runDto(run),
          claim,
          replayed,
          openAlerts: openAlerts.map((alert) => ({
            id: alert.id,
            path: alert.normalizedPath,
            lastProbedAt: alert.lastProbedAt?.toISOString() ?? null,
          })),
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async completeRun({
    assertion,
    input: rawInput,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: z.infer<typeof WatchRouteAlertCompleteInput>
  }) {
    const input = WatchRouteAlertCompleteInput.parse(rawInput)
    return this.prisma.$transaction(
      async (tx) => {
        await consumeSeoWorkloadAssertion(tx, assertion)
        const run = await tx.watchRouteAlertRun.findUnique({
          where: { id: input.runId },
        })
        if (!run) throw new WatchRouteAlertConflictError("run_not_found")
        if (
          statusForReport(input.report) !== input.status ||
          input.report.lanes.some(
            (lane) =>
              new Date(lane.windowStart).getTime() !==
                run.windowStart.getTime() ||
              new Date(lane.windowEnd).getTime() !== run.windowEnd.getTime(),
          )
        ) {
          throw new WatchRouteAlertConflictError("invalid_run_report")
        }
        if (run.status !== "RUNNING") {
          if (run.status !== RUN_STATUS_BY_INPUT[input.status]) {
            throw new WatchRouteAlertConflictError("run_fence_lost")
          }
          return { run: this.runDto(run), replayed: true }
        }
        const now = new Date()
        const fenced = await tx.watchRouteAlertRun.updateMany({
          where: {
            id: run.id,
            status: "RUNNING",
            executionFenceGeneration: input.claimGeneration,
            executionClaimTokenHash: hash(input.claimToken),
            executionClaimExpiresAt: { gt: now },
          },
          data: {
            executionClaimTokenHash: null,
            executionClaimExpiresAt: null,
          },
        })
        if (fenced.count !== 1) {
          throw new WatchRouteAlertConflictError("run_fence_lost")
        }

        if (run.mode === "LIVE" && input.status !== "failed") {
          const observedKeys = new Set<string>()
          for (const observation of input.observations) {
            const normalizedPath = normalizeWatchRouteAlertPath(
              observation.path,
              run.origin,
            )
            const semanticKey = hash(`${run.propertyId}\n${normalizedPath}`)
            observedKeys.add(semanticKey)
            await this.persistObservation(
              tx,
              run,
              input,
              observation,
              normalizedPath,
              semanticKey,
            )
          }
          if (input.status === "completed") {
            for (const reprobe of input.reprobes) {
              const normalizedPath = normalizeWatchRouteAlertPath(
                reprobe.path,
                run.origin,
              )
              const semanticKey = hash(`${run.propertyId}\n${normalizedPath}`)
              if (observedKeys.has(semanticKey)) continue
              const alert = await tx.watchRouteAlert.findUnique({
                where: { semanticKey },
              })
              if (!alert || alert.lifecycle !== "OPEN") continue
              const probed = await tx.watchRouteAlert.updateMany({
                where: { id: alert.id, lifecycle: "OPEN" },
                data: {
                  lastProbedAt: new Date(reprobe.probe.probedAt),
                  lastHttpStatus: reprobe.probe.status,
                  lastProbeKind: reprobe.probe.kind,
                  latestRunId: run.id,
                },
              })
              if (
                probed.count !== 1 ||
                !healthyHtmlProbe(reprobe.probe, run.origin)
              )
                continue
              const recovered = await tx.watchRouteAlert.updateMany({
                where: { id: alert.id, lifecycle: "OPEN" },
                data: {
                  lifecycle: "RECOVERED",
                  recoveredAt: now,
                  latestRunId: run.id,
                },
              })
              if (recovered.count === 1) {
                await tx.watchRouteAlertEpisode.updateMany({
                  where: { alertId: alert.id, recoveredAt: null },
                  data: {
                    recoveredAt: now,
                    recoveredByRunId: run.id,
                    detailExpiresAt: plusMs(now, EPISODE_RETENTION_MS),
                  },
                })
              }
            }
            const progress =
              await tx.watchRouteAlertPropertyProgress.findUnique({
                where: { propertyId: run.propertyId },
              })
            if (!progress || progress.lastCompleteWindowEnd < run.windowEnd) {
              await tx.watchRouteAlertPropertyProgress.upsert({
                where: { propertyId: run.propertyId },
                update: {
                  lastCompleteWindowStart: run.windowStart,
                  lastCompleteWindowEnd: run.windowEnd,
                  lastCompleteRunId: run.id,
                },
                create: {
                  propertyId: run.propertyId,
                  lastCompleteWindowStart: run.windowStart,
                  lastCompleteWindowEnd: run.windowEnd,
                  lastCompleteRunId: run.id,
                },
              })
            }
          }
        }

        const completed = await tx.watchRouteAlertRun.update({
          where: { id: run.id },
          data: {
            status: RUN_STATUS_BY_INPUT[input.status],
            manifestVersion: input.manifestVersion,
            report: boundedJson(input.report),
            actionableCount: input.observations.length,
            noiseCount: input.noiseCount,
            completedAt: now,
          },
        })
        return { run: this.runDto(completed), replayed: false }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 55_000,
      },
    )
  }

  async listManagerAlerts({
    user,
    limit = 25,
    after,
  }: {
    user: Principal | null
    limit?: number
    after?: string | null
  }) {
    if (!hasPermission(user, "read:manager-watch-route-alerts")) {
      throw new ForbiddenError()
    }
    const take = Math.min(100, Math.max(1, limit))
    const cursor = decodeAlertCursor(after)
    const readAt = new Date()
    const detailCutoff = plusMs(readAt, -RUN_DETAIL_RETENTION_MS)
    const [
      latestRun,
      latestPropertyRuns,
      alerts,
      totalCount,
      open,
      critical,
      supported,
      plausible,
      recovered,
      latestCompleted,
    ] = await Promise.all([
      this.prisma.watchRouteAlertRun.findFirst({
        where: { mode: "LIVE" },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          mode: true,
          status: true,
          startedAt: true,
          completedAt: true,
          report: true,
          propertyId: true,
          detailExpiresAt: true,
          detailExpiredAt: true,
        },
      }),
      this.prisma.watchRouteAlertRun.findMany({
        where: { mode: "LIVE" },
        distinct: ["propertyId"],
        orderBy: [{ propertyId: "asc" }, { startedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          propertyId: true,
          mode: true,
          status: true,
          startedAt: true,
          completedAt: true,
          report: true,
          detailExpiresAt: true,
          detailExpiredAt: true,
        },
        take: MANAGER_PROPERTY_RUN_LIMIT + 1,
      }),
      this.prisma.watchRouteAlert.findMany({
        orderBy: [
          { lifecycle: "asc" },
          { severity: "asc" },
          { latestCount: "desc" },
          { lastSeenAt: "desc" },
          { id: "asc" },
        ],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: take + 1,
        select: {
          id: true,
          propertyId: true,
          origin: true,
          normalizedPath: true,
          lifecycle: true,
          verdict: true,
          severity: true,
          latestCount: true,
          countKind: true,
          activeUsers: true,
          occurrenceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastProbedAt: true,
          lastHttpStatus: true,
          manifestVersion: true,
          latestEvidence: true,
        },
      }),
      this.prisma.watchRouteAlert.count(),
      this.prisma.watchRouteAlert.count({ where: { lifecycle: "OPEN" } }),
      this.prisma.watchRouteAlert.count({
        where: { lifecycle: "OPEN", severity: "CRITICAL" },
      }),
      this.prisma.watchRouteAlert.count({
        where: { lifecycle: "OPEN", verdict: "SUPPORTED_ROUTE_FAILURE" },
      }),
      this.prisma.watchRouteAlert.count({
        where: { lifecycle: "OPEN", verdict: "PLAUSIBLE_MISSING_ROUTE" },
      }),
      this.prisma.watchRouteAlert.count({ where: { lifecycle: "RECOVERED" } }),
      this.prisma.watchRouteAlertRun.findFirst({
        where: { status: "COMPLETED", mode: "LIVE" },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        select: { completedAt: true },
      }),
    ])
    const hasNextPage = alerts.length > take
    const page = alerts.slice(0, take)
    const propertyRuns = latestPropertyRuns.slice(0, MANAGER_PROPERTY_RUN_LIMIT)
    const propertyRunsTruncated =
      latestPropertyRuns.length > MANAGER_PROPERTY_RUN_LIMIT
    const runDetailAvailable = (run: {
      detailExpiresAt?: Date
      detailExpiredAt?: Date | null
    }) =>
      run.detailExpiredAt == null &&
      (run.detailExpiresAt == null || run.detailExpiresAt > readAt)
    const lanesForRun = (run: (typeof latestPropertyRuns)[number]) =>
      runDetailAvailable(run) ? reportLanes(run.report) : []
    const propertyStates = propertyRuns.map((run) =>
      monitorStateFor(run, lanesForRun(run)),
    )
    const monitorState = propertyStates.includes("UNAVAILABLE")
      ? "UNAVAILABLE"
      : propertyRunsTruncated || propertyStates.includes("PARTIAL")
        ? "PARTIAL"
        : propertyStates.includes("HEALTHY")
          ? "HEALTHY"
          : "NEVER_RUN"
    const runDto = (run: (typeof latestPropertyRuns)[number]) => ({
      id: run.id,
      propertyId: run.propertyId,
      mode: run.mode,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      lanes: lanesForRun(run),
      validationCaveats: runDetailAvailable(run)
        ? reportValidationCaveats(run.report)
        : ["Run detail expired under the 90-day retention policy."],
    })

    return {
      generatedAt: new Date().toISOString(),
      monitorState,
      recoverySuppressed: Boolean(
        propertyStates.some((state) => state !== "HEALTHY"),
      ),
      lastSuccessfulAt: latestCompleted?.completedAt?.toISOString() ?? null,
      latestRun: latestRun ? runDto(latestRun) : null,
      propertyRuns: propertyRuns.map(runDto),
      propertyRunsTruncated,
      summary: {
        open,
        critical,
        supportedRouteFailures: supported,
        plausibleMissingRoutes: plausible,
        recovered,
      },
      items: page.map((alert) => ({
        id: alert.id,
        propertyId: alert.propertyId,
        origin: alert.origin,
        path: alert.normalizedPath,
        lifecycle: alert.lifecycle,
        verdict: alert.verdict,
        severity: alert.severity,
        count: alert.latestCount,
        countKind: alert.countKind,
        activeUsers: alert.activeUsers,
        occurrenceCount: alert.occurrenceCount,
        firstSeenAt: alert.firstSeenAt.toISOString(),
        lastSeenAt: alert.lastSeenAt.toISOString(),
        lastProbedAt: alert.lastProbedAt?.toISOString() ?? null,
        httpStatus: alert.lastHttpStatus,
        manifestVersion: alert.manifestVersion,
        sources:
          alert.lastSeenAt > detailCutoff
            ? evidenceSources(alert.latestEvidence)
            : [],
      })),
      totalCount,
      showing: page.length,
      hasNextPage,
      nextCursor: hasNextPage ? encodeAlertCursor(page.at(-1)?.id ?? "") : null,
    }
  }

  private async persistObservation(
    tx: Prisma.TransactionClient,
    run: {
      id: string
      propertyId: string
      origin: string
    },
    completion: z.infer<typeof WatchRouteAlertCompleteInput>,
    observation: z.infer<typeof ObservationInput>,
    normalizedPath: string,
    semanticKey: string,
  ) {
    const firstSeenAt = new Date(observation.firstSeenAt)
    const lastSeenAt = new Date(observation.lastSeenAt)
    if (lastSeenAt < firstSeenAt) {
      throw new WatchRouteAlertConflictError("invalid_observation_window")
    }
    const derivedSeverity = severity(observation.verdict, observation.count)
    const evidence = boundedJson(observation.evidence)
    const alert = await tx.watchRouteAlert.upsert({
      where: { semanticKey },
      update: {},
      create: {
        semanticKey,
        propertyId: run.propertyId,
        origin: run.origin,
        normalizedPath,
        verdict: VERDICT_BY_INPUT[observation.verdict],
        severity: derivedSeverity,
        countKind: COUNT_KIND_BY_INPUT[observation.countKind],
        firstSeenAt,
        lastSeenAt,
        manifestVersion: completion.manifestVersion ?? "unknown",
        latestRunId: run.id,
      },
    })
    let episode = await tx.watchRouteAlertEpisode.findFirst({
      where: { alertId: alert.id, recoveredAt: null },
      orderBy: { sequence: "desc" },
    })
    if (!episode) {
      const last = await tx.watchRouteAlertEpisode.findFirst({
        where: { alertId: alert.id },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      })
      episode = await tx.watchRouteAlertEpisode.create({
        data: {
          alertId: alert.id,
          sequence: (last?.sequence ?? 0) + 1,
          openedAt: firstSeenAt,
          lastSeenAt,
          openedByRunId: run.id,
          evidence,
        },
      })
    }
    await tx.watchRouteAlertDailyObservation.create({
      data: {
        runId: run.id,
        alertId: alert.id,
        observedOn: new Date(
          `${observation.lastSeenAt.slice(0, 10)}T00:00:00.000Z`,
        ),
        count: observation.count,
        countKind: COUNT_KIND_BY_INPUT[observation.countKind],
        activeUsers: observation.activeUsers,
        verdict: VERDICT_BY_INPUT[observation.verdict],
        severity: derivedSeverity,
        evidence,
        observedAt: lastSeenAt,
        expiresAt: plusMs(new Date(), RUN_DETAIL_RETENTION_MS),
      },
    })
    await tx.watchRouteAlert.update({
      where: { id: alert.id },
      data: {
        lifecycle: "OPEN",
        verdict: VERDICT_BY_INPUT[observation.verdict],
        severity: derivedSeverity,
        latestCount: observation.count,
        countKind: COUNT_KIND_BY_INPUT[observation.countKind],
        activeUsers: observation.activeUsers,
        occurrenceCount: { increment: 1 },
        firstSeenAt:
          alert.firstSeenAt < firstSeenAt ? alert.firstSeenAt : firstSeenAt,
        lastSeenAt,
        lastProbedAt: new Date(observation.probe.probedAt),
        lastHttpStatus: observation.probe.status,
        lastProbeKind: observation.probe.kind,
        manifestVersion: completion.manifestVersion ?? "unknown",
        latestEvidence: evidence,
        latestRunId: run.id,
        recoveredAt: null,
      },
    })
    await tx.watchRouteAlertEpisode.update({
      where: { id: episode.id },
      data: { lastSeenAt, evidence },
    })
  }

  private runDto(run: {
    id: string
    propertyId: string
    mode: string
    status: string
    windowStart: Date
    windowEnd: Date
    startedAt: Date
    completedAt: Date | null
  }) {
    return {
      id: run.id,
      propertyId: run.propertyId,
      mode: run.mode.toLowerCase(),
      status: run.status.toLowerCase(),
      windowStart: run.windowStart.toISOString(),
      windowEnd: run.windowEnd.toISOString(),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    }
  }
}
