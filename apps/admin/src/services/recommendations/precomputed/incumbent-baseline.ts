import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { ForbiddenError } from "@/services/errors"
import { runRecommendationDeliveryTransaction } from "../delivery-runtime"
import { assertWebRecommendationCaller } from "../caller"
import { verifyWatchHumanReceipt } from "./human-verification"
import { PRECOMPUTED_PUBLIC_CONTROL_ID } from "./public-control"
import { precomputedBrowserUnitDigest } from "./visit-identity"
import { readControlRouting } from "./visit-admission"
import { verifyPrecomputedSourceEligibility } from "./watch-reader"

const HOUR_MS = 3_600_000
const WINDOW_MS = 7 * 24 * HOUR_MS
const LATE_MS = 24 * HOUR_MS
const FINALIZATION_GRACE_MS = 5 * 60_000
const RAW_MS = 29 * 24 * HOUR_MS
const REVIEW_MS = 365 * 24 * HOUR_MS
const HEX_DIGEST = /^[a-f0-9]{64}$/

export function isDisposableBaselineDatabase(
  name: string,
  schema: string,
): boolean {
  return (
    ["forge_capacity", "forge_precomputed_control_test"].includes(name) &&
    /^(precomputed_public_|catalog_producer_)[a-zA-Z0-9_]+$/.test(schema)
  )
}

async function assertLocalBaselineFixture(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const databaseUrl = new URL(env.DATABASE_URL)
  if (
    env.NODE_ENV === "production" ||
    env.WATCH_RECOMMENDATION_TURNSTILE_TEST_FIXTURE_ENABLED !== "1" ||
    !["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)
  )
    throw new PrecomputedBaselineError("verification_unavailable")
  const [database] = await prisma.$queryRaw<
    Array<{ name: string; schema: string }>
  >`
    SELECT current_database()::text AS name, current_schema()::text AS schema`
  if (
    !isDisposableBaselineDatabase(database?.name ?? "", database?.schema ?? "")
  )
    throw new PrecomputedBaselineError("verification_unavailable")
}

export class PrecomputedBaselineError extends Error {
  constructor(
    readonly code:
      | "incompatible_state"
      | "invalid_input"
      | "verification_unavailable",
  ) {
    super(code)
    this.name = "PrecomputedBaselineError"
  }
}

export type PrecomputedBaselineState = {
  id: string
  status: "scheduled" | "active" | "ended" | "stopped"
  startsAt: string
  endsAt: string
  stoppedAt: string | null
  stoppedBy: string | null
  controlRoutingDigest: string
  verificationAuthority: "isolated_fixture" | "live_verified"
  finalReportDigest: string | null
  lateEventCutoffHours: 24
} | null

function baselineState(
  row: {
    id: string
    enabled: boolean
    startsAt: Date
    endsAt: Date
    stoppedAt: Date | null
    stoppedBy: string | null
    controlRoutingDigest: string
    verificationAuthority: string
    finalReportDigest: string | null
  } | null,
  now: Date,
): PrecomputedBaselineState {
  if (!row) return null
  return {
    id: row.id,
    status: !row.enabled
      ? "stopped"
      : now < row.startsAt
        ? "scheduled"
        : now >= row.endsAt
          ? "ended"
          : "active",
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    stoppedBy: row.stoppedBy,
    controlRoutingDigest: row.controlRoutingDigest,
    verificationAuthority: row.verificationAuthority as
      | "isolated_fixture"
      | "live_verified",
    finalReportDigest: row.finalReportDigest,
    lateEventCutoffHours: 24,
  }
}

export async function loadPrecomputedIncumbentBaseline(
  prisma: PrismaClient | Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<PrecomputedBaselineState> {
  const row = await prisma.recommendationPrecomputedBaselineRun.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })
  return baselineState(row, now)
}

/** A separate operator action schedules a one-week incumbent-only baseline
 * on full UTC hours. The public serving pointer stays incumbent throughout. */
export async function startPrecomputedIncumbentBaseline(
  prisma: PrismaClient,
  input: { operator: Principal | null; now?: Date },
): Promise<PrecomputedBaselineState> {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (!input.operator?.id) throw new PrecomputedBaselineError("invalid_input")
  if (
    !env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET ||
    !env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES
  )
    throw new PrecomputedBaselineError("verification_unavailable")
  const now = input.now ?? new Date()
  const verificationAuthority =
    env.WATCH_RECOMMENDATION_TURNSTILE_TEST_FIXTURE_ENABLED === "1"
      ? "isolated_fixture"
      : "live_verified"
  if (verificationAuthority === "isolated_fixture")
    await assertLocalBaselineFixture(prisma)
  else if (env.NODE_ENV !== "production")
    throw new PrecomputedBaselineError("verification_unavailable")
  const startsAt = new Date((Math.floor(now.getTime() / HOUR_MS) + 1) * HOUR_MS)
  const endsAt = new Date(startsAt.getTime() + WINDOW_MS)
  return prisma.$transaction(async (tx) => {
    const [pointer] = await tx.$queryRaw<Array<{ mode: string }>>`
      SELECT mode FROM recommendation_precomputed_public_control
      WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR UPDATE`
    const existing = await tx.recommendationPrecomputedBaselineRun.findFirst({
      where: { enabled: true },
      select: { id: true },
    })
    const routing = await readControlRouting(tx)
    if (pointer?.mode !== "incumbent" || existing || !routing)
      throw new PrecomputedBaselineError("incompatible_state")
    const row = await tx.recommendationPrecomputedBaselineRun.create({
      data: {
        id: randomUUID(),
        enabled: true,
        verificationAuthority,
        startsAt,
        endsAt,
        controlRoutingDigest: routing.routingDigest,
        actorId: input.operator!.id!,
        createdAt: now,
        expiresAt: new Date(endsAt.getTime() + REVIEW_MS),
      },
    })
    return baselineState(row, now)
  })
}

export async function stopPrecomputedIncumbentBaseline(
  prisma: PrismaClient,
  input: { baselineId: string; operator: Principal | null; now?: Date },
): Promise<PrecomputedBaselineState> {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (!input.operator?.id || !/^[0-9a-f-]{36}$/i.test(input.baselineId))
    throw new PrecomputedBaselineError("invalid_input")
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM recommendation_precomputed_public_control
      WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR UPDATE`
    const row = await tx.recommendationPrecomputedBaselineRun.findUnique({
      where: { id: input.baselineId },
    })
    if (!row?.enabled) throw new PrecomputedBaselineError("incompatible_state")
    const updated = await tx.recommendationPrecomputedBaselineRun.update({
      where: { id: row.id },
      data: { enabled: false, stoppedAt: now, stoppedBy: input.operator!.id! },
    })
    return baselineState(updated, now)
  })
}

export type BaselineAdmissionInput = {
  visitId: string
  browserDigest: string
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  humanVerificationReceipt?: string | null
  caller: Principal | null
  now: Date
}

/** Null means baseline is off; a reason means no baseline visit was written. */
export async function admitPrecomputedIncumbentBaseline(
  tx: Prisma.TransactionClient,
  input: BaselineAdmissionInput,
): Promise<{ baselineId: string; reason: string | null } | null> {
  const [pointer] = await tx.$queryRaw<Array<{ mode: string }>>`
    SELECT mode FROM recommendation_precomputed_public_control
    WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR SHARE`
  if (pointer?.mode !== "incumbent") return null
  const run = await tx.recommendationPrecomputedBaselineRun.findFirst({
    where: {
      enabled: true,
      startsAt: { lte: input.now },
      endsAt: { gt: input.now },
    },
  })
  if (!run) return null
  const base = { baselineId: run.id }
  if (
    (await readControlRouting(tx))?.routingDigest !== run.controlRoutingDigest
  )
    return { ...base, reason: "baseline_routing_changed" }
  if (!(await verifyPrecomputedSourceEligibility(tx, input)))
    return { ...base, reason: "source_unavailable" }
  if (!input.humanVerificationReceipt)
    return { ...base, reason: "verification_required" }
  if (run.verificationAuthority === "isolated_fixture")
    await assertLocalBaselineFixture(tx)
  if (
    !env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET ||
    !env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES
  )
    return { ...base, reason: "live_qualification_unavailable" }
  if (
    !verifyWatchHumanReceipt(
      { ...input, receipt: input.humanVerificationReceipt },
      {
        secret: env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET,
        allowedHostnames: env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES,
        allowFixtureHostname:
          run.verificationAuthority === "isolated_fixture" &&
          env.NODE_ENV !== "production",
      },
    )
  )
    return { ...base, reason: "verification_required" }
  const browserUnitDigest = precomputedBrowserUnitDigest(
    run.id,
    input.browserDigest,
  )
  await tx.recommendationPrecomputedBaselineVisit.createMany({
    data: [
      {
        id: input.visitId,
        runId: run.id,
        browserUnitDigest,
        sourceVideoId: input.seedMediaId,
        locale: input.locale,
        audioLanguageSlug: input.audioLanguageSlug,
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + RAW_MS),
      },
    ],
    skipDuplicates: true,
  })
  const visit =
    await tx.recommendationPrecomputedBaselineVisit.findUniqueOrThrow({
      where: { id: input.visitId },
    })
  if (
    visit.runId !== run.id ||
    visit.browserUnitDigest !== browserUnitDigest ||
    visit.sourceVideoId !== input.seedMediaId ||
    visit.locale !== input.locale ||
    visit.audioLanguageSlug !== input.audioLanguageSlug
  )
    return { ...base, reason: "visit_identity_conflict" }
  return { ...base, reason: null }
}

export async function recordPrecomputedIncumbentBaselineDelivery(
  prisma: PrismaClient,
  input: {
    visitId: string
    browserDigest: string
    sourceVideoId: string
    result: "served" | "fallback" | "empty" | "unavailable"
    requestId: string | null
    caller: Principal | null
    deadlineAt: number
  },
): Promise<"recorded" | "conflict" | "unavailable"> {
  assertWebRecommendationCaller(input.caller)
  if (!HEX_DIGEST.test(input.browserDigest)) return "unavailable"
  try {
    return await runRecommendationDeliveryTransaction(
      prisma,
      input.deadlineAt,
      async (tx) => {
        const visit =
          await tx.recommendationPrecomputedBaselineVisit.findUnique({
            where: { id: input.visitId },
            include: { run: true },
          })
        const now = new Date()
        if (
          !visit ||
          visit.expiresAt <= now ||
          visit.run.finalReport ||
          now >= new Date(visit.run.endsAt.getTime() + LATE_MS) ||
          visit.sourceVideoId !== input.sourceVideoId ||
          visit.browserUnitDigest !==
            precomputedBrowserUnitDigest(visit.runId, input.browserDigest)
        )
          return "unavailable"
        if (input.requestId) {
          const request = await tx.recommendationRequest.findUnique({
            where: { id: input.requestId },
            select: { seedMediaId: true, expiresAt: true },
          })
          if (
            !request ||
            request.seedMediaId !== visit.sourceVideoId ||
            request.expiresAt <= now
          )
            return "conflict"
          await tx.recommendationPrecomputedBaselineVisitRequest.createMany({
            data: [
              {
                requestId: input.requestId,
                visitId: visit.id,
                createdAt: now,
                expiresAt: new Date(
                  Math.min(
                    visit.expiresAt.getTime(),
                    request.expiresAt.getTime(),
                  ),
                ),
              },
            ],
            skipDuplicates: true,
          })
          const link =
            await tx.recommendationPrecomputedBaselineVisitRequest.findUniqueOrThrow(
              {
                where: { requestId: input.requestId },
              },
            )
          if (link.visitId !== visit.id) return "conflict"
        }
        const priority = {
          not_attempted: 0,
          unavailable: 1,
          empty: 2,
          served: 3,
          fallback: 3,
        } as const
        if (
          priority[input.result] >
          (priority[visit.deliveryResult as keyof typeof priority] ?? -1)
        )
          await tx.recommendationPrecomputedBaselineVisit.update({
            where: { id: visit.id },
            data: { deliveryResult: input.result },
          })
        return "recorded"
      },
      Date.now,
    )
  } catch {
    return "unavailable"
  }
}

/** A baseline click must come from the same signed browser that qualified the
 * visit. Ordinary incumbent requests remain unaffected. */
export async function checkPrecomputedBaselineClickBrowser(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string
    browserDigest: string | null | undefined
    now: Date
  },
): Promise<"unbound" | "valid" | "invalid"> {
  const link =
    await tx.recommendationPrecomputedBaselineVisitRequest.findUnique({
      where: { requestId: input.requestId },
      include: { visit: true },
    })
  if (!link) return "unbound"
  if (
    !input.browserDigest ||
    !HEX_DIGEST.test(input.browserDigest) ||
    link.expiresAt <= input.now ||
    link.visit.expiresAt <= input.now ||
    link.visit.browserUnitDigest !==
      precomputedBrowserUnitDigest(link.visit.runId, input.browserDigest)
  )
    return "invalid"
  return "valid"
}

export type PrecomputedBaselineReport = {
  baselineId: string
  startsAt: string
  endsAt: string
  observedAt: string
  isFinal: boolean
  eligibleVisits: number
  clickedVisits: number
  visitCtr: number | null
  independentBrowsers: number
  visitsPerBrowser: Record<string, number>
  servedVisits: number
  unavailableVisits: number
  linkedDeliveryRequests: number
  cardClicks: number
  evidenceBasis: "verified_incumbent_baseline" | "isolated_fixture"
  webRequestHealth: "not_yet_reconciled"
}

/** Selection receipts are already committed by the incumbent path. Count a
 * UUID once even after retry; no raw browser digest is returned to Admin. */
export async function loadPrecomputedIncumbentBaselineReport(
  prisma: PrismaClient | Prisma.TransactionClient,
  baselineId: string,
  now: Date = new Date(),
): Promise<PrecomputedBaselineReport | null> {
  const run = await prisma.recommendationPrecomputedBaselineRun.findUnique({
    where: { id: baselineId },
  })
  if (!run) return null
  if (run.finalReport) return run.finalReport as PrecomputedBaselineReport
  const effectiveEnd =
    run.stoppedAt && run.stoppedAt < run.endsAt ? run.stoppedAt : run.endsAt
  const cutoff = new Date(effectiveEnd.getTime() + LATE_MS)
  const [totals] = await prisma.$queryRaw<
    Array<{
      eligible: bigint
      clicked: bigint
      browsers: bigint
      served: bigint
      unavailable: bigint
      links: bigint
      card_clicks: bigint
    }>
  >`
    WITH clicks AS (
      SELECT DISTINCT link.visit_id
      FROM recommendation_precomputed_baseline_visit_request link
      JOIN recommendation_precomputed_baseline_visit v ON v.id = link.visit_id
      JOIN recommendation_selection selection ON selection.request_id = link.request_id
      WHERE v.run_id = ${baselineId}::uuid
        AND selection.received_at >= link.created_at
        AND selection.received_at < LEAST(link.expires_at, ${cutoff})
    )
    SELECT count(*) AS eligible,
      count(DISTINCT visit.browser_unit_digest) AS browsers,
      count(*) FILTER (WHERE clicks.visit_id IS NOT NULL) AS clicked,
      count(*) FILTER (WHERE visit.delivery_result IN ('served', 'fallback')) AS served,
      count(*) FILTER (WHERE visit.delivery_result = 'unavailable') AS unavailable,
      (SELECT count(*) FROM recommendation_precomputed_baseline_visit_request link
       JOIN recommendation_precomputed_baseline_visit v ON v.id = link.visit_id
       WHERE v.run_id = ${baselineId}::uuid) AS links,
      (SELECT count(*) FROM recommendation_selection selection
       JOIN recommendation_precomputed_baseline_visit_request link ON link.request_id = selection.request_id
       JOIN recommendation_precomputed_baseline_visit v ON v.id = link.visit_id
       WHERE v.run_id = ${baselineId}::uuid
         AND selection.received_at >= link.created_at
         AND selection.received_at < LEAST(link.expires_at, ${cutoff})) AS card_clicks
    FROM recommendation_precomputed_baseline_visit visit
    LEFT JOIN clicks ON clicks.visit_id = visit.id
    WHERE visit.run_id = ${baselineId}::uuid`
  const distribution = await prisma.$queryRaw<
    Array<{ visits: bigint; browsers: bigint }>
  >`
    SELECT visits, count(*) AS browsers FROM (
      SELECT count(*) AS visits FROM recommendation_precomputed_baseline_visit
      WHERE run_id = ${baselineId}::uuid GROUP BY browser_unit_digest
    ) browser GROUP BY visits ORDER BY visits`
  const eligibleVisits = Number(totals.eligible)
  const visitsPerBrowser: Record<string, number> = {}
  for (const row of distribution) {
    const bucket = Number(row.visits) >= 10 ? "10+" : String(row.visits)
    visitsPerBrowser[bucket] =
      (visitsPerBrowser[bucket] ?? 0) + Number(row.browsers)
  }
  const report: PrecomputedBaselineReport = {
    baselineId,
    startsAt: run.startsAt.toISOString(),
    endsAt: effectiveEnd.toISOString(),
    observedAt: now.toISOString(),
    isFinal: now >= new Date(cutoff.getTime() + FINALIZATION_GRACE_MS),
    eligibleVisits,
    clickedVisits: Number(totals.clicked),
    visitCtr: eligibleVisits ? Number(totals.clicked) / eligibleVisits : null,
    independentBrowsers: Number(totals.browsers),
    visitsPerBrowser,
    servedVisits: Number(totals.served),
    unavailableVisits: Number(totals.unavailable),
    linkedDeliveryRequests: Number(totals.links),
    cardClicks: Number(totals.card_clicks),
    evidenceBasis:
      run.verificationAuthority === "live_verified"
        ? "verified_incumbent_baseline"
        : "isolated_fixture",
    webRequestHealth: "not_yet_reconciled",
  }
  if (!report.isFinal) return report
  const digest = createHash("sha256")
    .update(JSON.stringify(report))
    .digest("hex")
  const saved = await prisma.recommendationPrecomputedBaselineRun.updateMany({
    where: { id: baselineId, finalReport: { equals: Prisma.DbNull } },
    data: { finalReport: report, finalReportDigest: digest },
  })
  return saved.count
    ? report
    : ((
        await prisma.recommendationPrecomputedBaselineRun.findUniqueOrThrow({
          where: { id: baselineId },
          select: { finalReport: true },
        })
      ).finalReport as PrecomputedBaselineReport)
}
