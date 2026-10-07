import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "@/services/errors"
import {
  blankCtrTotals,
  ctrTotalFields,
  rawCtrVisitSql,
  type CtrTotals,
} from "./ctr-evidence"
import { lockPrecomputedCtrEvidence } from "./ctr-fence"
import { PRECOMPUTED_VISIT_ELIGIBILITY_POLICY } from "./visit-admission"
import {
  evaluatePrecomputedCtr,
  validateCtrPolicySettings,
  type CtrArmMoments,
  type CtrPolicySettings,
} from "./ctr-policy"
import {
  loadWebWatchMeasurement,
  type WebWatchMeasurementRead,
} from "./web-measurement"

export const PRECOMPUTED_CTR_METHOD = "fixed-horizon-cluster-delta-t-v1"
const METHOD = PRECOMPUTED_CTR_METHOD
type Arm = "control" | "challenger"
type TotalsRow = CtrTotals & { arm: Arm | "excluded" }
type MomentRow = {
  arm: Arm
  browsers: string
  eligible_visits: string
  clicked_visits: string
  sum_visits_squared: string
  sum_clicks_squared: string
  sum_visits_clicks: string
}

export type PrecomputedCtrReport = {
  schemaVersion: 1
  evidenceBasis?: "private_unverified" | "isolated_fixture" | "live_incomplete"
  experimentId: string
  revision: number
  isFinal: boolean
  asOf: string
  generationId: string
  controlManifestId: string
  controlManifestDigest: string
  controlRoutingDigest: string
  sourceSetDigest: string
  configurationDigest: string
  liveLaunchEvidence?: {
    evidenceDigest: string
    baselineReportDigest: string
    launchCapacityReceiptDigest: string
    authoritativeCatalogSourceSetDigest: string
  }
  eligibilityPolicyVersion: string
  policy: {
    version: string
    method: typeof METHOD
    digest: string
    authority: "fixture_only" | "prelaunch_agreed"
    settings: CtrPolicySettings
  }
  cohort: { startsAt: string; endsAt: string; finalAt: string }
  byArm: Record<
    Arm,
    {
      eligibleVisits: number
      clickedVisits: number
      visitCtr: number | null
      acceptedSelections: number
      qualifiedImpressions: number
      matchedSelections: number
      cardCtr: number | null
      servedVisits: number
      emptyVisits: number
      unavailableVisits: number
      notAttemptedVisits: number
      actualFallbackVisits: number
      actualFallbackRate: number | null
      privateRecoveryAttemptVisits: number
      privateRecoveryAttemptRate: number | null
      unlinkedDeliveredVisits: number
      independentBrowsers: number
      effectiveBrowsers: number | null
    }
  >
  exclusions: {
    automation: number
    preview: number
    unknown: number
    outsideCohort: number
    other: number
  }
  measurementHealth: {
    botEligibility: "unverified" | "fixture_verified" | "durable_rows_verified"
    trackingLoss: "unobservable" | "fixture_verified"
    endToEndClientEventCompleteness?: "unverified"
    webRequestHealth?: {
      status: "complete" | "incomplete" | "unavailable"
      requestedHours: number
      coveredHours: number
      missingHourCount: number
      imbalancedHourCount: number
      qualifiedRequestAttempts: number
      clickAcknowledgements: number
      clickUnavailable: number
      verificationUnavailable: number
    }
    /** Known bots/prefetches skipped by Web are outside this report. */
    edgeAutomationCoverage?: "partial_unverified"
    exclusionCountScope?: "admin_bound_only"
    unversionedArchivedVisits: number
    attribution: "server_bound_request_and_item"
  }
  uncertainty: {
    method: typeof METHOD
    clusterCorrection: "m_over_m_minus_1"
    confidence: 0.95
    difference: number | null
    standardError: number | null
    lowerBound: number | null
    upperBound: number | null
    criticalValue: number | null
    conservativeDegreesOfFreedom: number | null
  }
  outcome: "control" | "challenger" | "inconclusive"
  reasons: string[]
}

export type PrecomputedCtrRead =
  | { status: "unavailable"; reason: string }
  | { status: "available"; report: PrecomputedCtrReport }

export type PrecomputedCtrIndex = {
  policyDeclared: boolean
  canDeclarePolicy: boolean
  declarationUnavailableReason: "visits_exist" | "experiment_unavailable" | null
  revisions: { revision: number; isFinal: boolean; asOf: Date }[]
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex")
}

export function precomputedCtrPolicyDigest(
  settings: CtrPolicySettings,
): string {
  return digest([METHOD, settings])
}

function safe(value: bigint | string | number): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("precomputed_ctr_count_overflow")
  return n
}

function blankMoments(): CtrArmMoments {
  return {
    browsers: 0,
    eligibleVisits: 0,
    clickedVisits: 0,
    sumVisitsSquared: 0,
    sumClicksSquared: 0,
    sumVisitsClicks: 0,
    actualFallbackVisits: 0,
    unlinkedDeliveredVisits: 0,
  }
}

/** Explicit fixture settings never claim that a human baseline or numerical
 * stopping rule was agreed. A later launch control must supply that authority. */
export async function declareFixturePrecomputedCtrPolicy(
  prisma: PrismaClient,
  input: {
    experimentId: string
    settings: CtrPolicySettings
    operator: Principal | null
  },
) {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  validateCtrPolicySettings(input.settings)
  return prisma.$transaction(async (tx) => {
    await lockPrecomputedCtrEvidence(tx, input.experimentId, "exclusive")
    const experiment = await tx.recommendationPrecomputedExperiment.findUnique({
      where: { id: input.experimentId },
      select: { id: true, state: true },
    })
    if (!experiment || experiment.state !== "private_test")
      throw new Error("precomputed_ctr_experiment_unavailable")
    if (
      await tx.recommendationPrecomputedVisit.count({
        where: { experimentId: input.experimentId },
      })
    )
      throw new Error("precomputed_ctr_policy_must_precede_visits")
    if (
      await tx.recommendationPrecomputedCtrArchivedVisit.count({
        where: { experimentId: input.experimentId },
      })
    )
      throw new Error("precomputed_ctr_policy_must_precede_visits")
    return tx.recommendationPrecomputedCtrPolicy.create({
      data: {
        experimentId: input.experimentId,
        version: METHOD,
        method: METHOD,
        settings: input.settings,
        lateEventCutoffHours: input.settings.lateEventCutoffHours,
        settingsDigest: precomputedCtrPolicyDigest(input.settings),
        authority: "fixture_only",
      },
    })
  })
}

async function readEvidence(
  tx: Prisma.TransactionClient,
  experimentId: string,
  asOf: Date,
) {
  const active = rawCtrVisitSql(
    Prisma.sql`v.experiment_id = ${experimentId} AND v.created_at <= ${asOf}`,
    asOf,
  )
  const [momentRows, rawTotals, archivedTotals] = await Promise.all([
    tx.$queryRaw<MomentRow[]>(Prisma.sql`
      WITH active AS (${active}), cluster_parts AS (
        SELECT arm, browser_unit_digest,
          count(*)::numeric AS n,
          count(*) FILTER (WHERE accepted_selections > 0)::numeric AS c
        FROM active WHERE eligibility = 'eligible'
        GROUP BY arm, browser_unit_digest
        UNION ALL
        SELECT arm::text, browser_unit_digest,
          eligible_visits::numeric, clicked_visits::numeric
        FROM recommendation_precomputed_ctr_cluster
        WHERE experiment_id = ${experimentId}
      ), combined AS (
        SELECT arm, browser_unit_digest, sum(n) AS n, sum(c) AS c
        FROM cluster_parts GROUP BY arm, browser_unit_digest
      )
      SELECT arm, count(*)::text AS browsers,
        sum(n)::text AS eligible_visits, sum(c)::text AS clicked_visits,
        sum(n*n)::text AS sum_visits_squared,
        sum(c*c)::text AS sum_clicks_squared,
        sum(n*c)::text AS sum_visits_clicks
      FROM combined GROUP BY arm
    `),
    tx.$queryRaw<TotalsRow[]>(Prisma.sql`
      WITH active AS (${active})
      SELECT CASE WHEN eligibility = 'eligible' THEN arm::text ELSE 'excluded' END AS arm,
        count(*) FILTER (WHERE eligibility = 'eligible') AS "eligibleVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND accepted_selections > 0) AS "clickedVisits",
        coalesce(sum(accepted_selections) FILTER (WHERE eligibility = 'eligible'), 0)::bigint AS "acceptedSelections",
        coalesce(sum(qualified_impressions) FILTER (WHERE eligibility = 'eligible'), 0)::bigint AS "qualifiedImpressions",
        coalesce(sum(matched_selections) FILTER (WHERE eligibility = 'eligible'), 0)::bigint AS "matchedSelections",
        count(*) FILTER (WHERE eligibility = 'eligible' AND delivery_result = 'served') AS "servedVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND delivery_result = 'empty') AS "emptyVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND delivery_result = 'unavailable') AS "unavailableVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND delivery_result = 'not_attempted') AS "notAttemptedVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND actual_fallback) AS "actualFallbackVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND private_recovery_attempt) AS "privateRecoveryAttemptVisits",
        count(*) FILTER (WHERE eligibility = 'eligible' AND unlinked_delivered) AS "unlinkedDeliveredVisits",
        count(*) FILTER (WHERE eligibility = 'excluded' AND qualification = 'declared_automation') AS "excludedAutomation",
        count(*) FILTER (WHERE eligibility = 'excluded' AND qualification = 'private_preview') AS "excludedPreview",
        count(*) FILTER (WHERE eligibility = 'excluded' AND qualification = 'unknown_signal') AS "excludedUnknown",
        count(*) FILTER (WHERE eligibility = 'excluded' AND exclusion_reason = 'outside_frozen_cohort') AS "excludedOutsideCohort",
        count(*) FILTER (WHERE eligibility = 'excluded' AND qualification NOT IN ('declared_automation', 'private_preview', 'unknown_signal') AND exclusion_reason IS DISTINCT FROM 'outside_frozen_cohort') AS "excludedOther",
        0::bigint AS "unversionedArchivedVisits"
      FROM active
      GROUP BY CASE WHEN eligibility = 'eligible' THEN arm::text ELSE 'excluded' END
    `),
    tx.recommendationPrecomputedCtrTotals.findMany({ where: { experimentId } }),
  ])
  const totals: Record<Arm | "excluded", CtrTotals> = {
    control: blankCtrTotals(),
    challenger: blankCtrTotals(),
    excluded: blankCtrTotals(),
  }
  for (const row of [...rawTotals, ...archivedTotals]) {
    if (
      row.arm !== "control" &&
      row.arm !== "challenger" &&
      row.arm !== "excluded"
    )
      throw new Error("precomputed_ctr_invalid_arm")
    for (const field of ctrTotalFields) totals[row.arm][field] += row[field]
  }
  const moments = { control: blankMoments(), challenger: blankMoments() }
  for (const row of momentRows) {
    if (row.arm !== "control" && row.arm !== "challenger")
      throw new Error("precomputed_ctr_invalid_arm")
    moments[row.arm] = {
      browsers: safe(row.browsers),
      eligibleVisits: safe(row.eligible_visits),
      clickedVisits: safe(row.clicked_visits),
      sumVisitsSquared: safe(row.sum_visits_squared),
      sumClicksSquared: safe(row.sum_clicks_squared),
      sumVisitsClicks: safe(row.sum_visits_clicks),
      actualFallbackVisits: safe(totals[row.arm].actualFallbackVisits),
      unlinkedDeliveredVisits: safe(totals[row.arm].unlinkedDeliveredVisits),
    }
  }
  for (const arm of ["control", "challenger"] as const) {
    if (
      moments[arm].eligibleVisits !== safe(totals[arm].eligibleVisits) ||
      moments[arm].clickedVisits !== safe(totals[arm].clickedVisits)
    )
      throw new Error("precomputed_ctr_cluster_totals_mismatch")
  }
  return { totals, moments }
}

function armReport(
  totals: CtrTotals,
  moments: CtrArmMoments,
  effective: number | null,
) {
  const n = safe(totals.eligibleVisits)
  const impressions = safe(totals.qualifiedImpressions)
  return {
    eligibleVisits: n,
    clickedVisits: safe(totals.clickedVisits),
    visitCtr: n ? safe(totals.clickedVisits) / n : null,
    acceptedSelections: safe(totals.acceptedSelections),
    qualifiedImpressions: impressions,
    matchedSelections: safe(totals.matchedSelections),
    cardCtr: impressions ? safe(totals.matchedSelections) / impressions : null,
    servedVisits: safe(totals.servedVisits),
    emptyVisits: safe(totals.emptyVisits),
    unavailableVisits: safe(totals.unavailableVisits),
    notAttemptedVisits: safe(totals.notAttemptedVisits),
    actualFallbackVisits: safe(totals.actualFallbackVisits),
    actualFallbackRate: n ? safe(totals.actualFallbackVisits) / n : null,
    privateRecoveryAttemptVisits: safe(totals.privateRecoveryAttemptVisits),
    privateRecoveryAttemptRate: n
      ? safe(totals.privateRecoveryAttemptVisits) / n
      : null,
    unlinkedDeliveredVisits: safe(totals.unlinkedDeliveredVisits),
    independentBrowsers: moments.browsers,
    effectiveBrowsers: effective,
  }
}

/** Evaluation mutates only append-only report rows. It cannot route traffic or
 * promote a generation. The exclusive fence gives one consistent raw/archive
 * snapshot and waits for accepted in-flight private evidence before finality. */
async function evaluatePrecomputedCtrReport(
  prisma: PrismaClient,
  input: {
    experimentId: string
    operator: Principal | null
    now?: Date
    evidenceBasis: "private_unverified" | "isolated_fixture" | "live_public"
    webMeasurement?: WebWatchMeasurementRead | null
  },
): Promise<PrecomputedCtrRead> {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  let publicEligibilityPolicy: string | null = null
  if (input.evidenceBasis !== "private_unverified") {
    const control = await import("./public-control")
    if (input.evidenceBasis === "isolated_fixture")
      await control.assertIsolatedPrecomputedControlFixture(prisma)
    publicEligibilityPolicy =
      input.evidenceBasis === "isolated_fixture"
        ? control.PRECOMPUTED_PUBLIC_ELIGIBILITY_POLICY
        : control.PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY
  }
  return prisma.$transaction(
    async (tx) => {
      await lockPrecomputedCtrEvidence(tx, input.experimentId, "exclusive")
      const asOf = input.now ?? new Date()
      const experiment =
        await tx.recommendationPrecomputedExperiment.findUnique({
          where: { id: input.experimentId },
          include: { ctrPolicy: true },
        })
      if (!experiment)
        return {
          status: "unavailable",
          reason: "experiment_not_found",
        } as const
      if (
        input.evidenceBasis !== "private_unverified" &&
        (experiment.state !== "public_ready" ||
          experiment.eligibilityPolicyVersion !== publicEligibilityPolicy)
      )
        return {
          status: "unavailable",
          reason: "public_experiment_unavailable",
        } as const
      if (
        input.evidenceBasis === "private_unverified" &&
        (!["private_test", "closed"].includes(experiment.state) ||
          ![
            "private-watch-visit-unverified-bot-v1",
            PRECOMPUTED_VISIT_ELIGIBILITY_POLICY,
          ].includes(experiment.eligibilityPolicyVersion))
      )
        return {
          status: "unavailable",
          reason: "private_experiment_unavailable",
        } as const
      if (!experiment.ctrPolicy)
        return {
          status: "unavailable",
          reason: "predeclared_policy_missing",
        } as const
      const policy = experiment.ctrPolicy
      if (policy.method !== METHOD || policy.version !== METHOD)
        return { status: "unavailable", reason: "unsupported_policy" } as const
      const settings = policy.settings as CtrPolicySettings
      validateCtrPolicySettings(settings)
      if (
        policy.lateEventCutoffHours !== settings.lateEventCutoffHours ||
        policy.settingsDigest !== precomputedCtrPolicyDigest(settings)
      )
        return {
          status: "unavailable",
          reason: "policy_integrity_failed",
        } as const
      const latest = await tx.recommendationPrecomputedCtrReport.findFirst({
        where: { experimentId: input.experimentId },
        orderBy: { revision: "desc" },
      })
      if (latest?.isFinal)
        return {
          status: "available",
          report: latest.result as unknown as PrecomputedCtrReport,
        } as const
      const { totals, moments } = await readEvidence(
        tx,
        input.experimentId,
        asOf,
      )
      const finalAt = new Date(
        experiment.endsAt.getTime() + settings.lateEventCutoffHours * 3_600_000,
      )
      const web = input.webMeasurement
      const livePublic = input.evidenceBasis === "live_public"
      const eligibleVisits = safe(
        totals.control.eligibleVisits + totals.challenger.eligibleVisits,
      )
      const acceptedSelections = safe(
        totals.control.acceptedSelections +
          totals.challenger.acceptedSelections,
      )
      const verifiedQualificationRows = livePublic
        ? await tx.$queryRaw<Array<{ unverified: bigint }>>`
            SELECT count(*)::bigint AS unverified
            FROM recommendation_precomputed_visit
            WHERE experiment_id = ${experiment.id}
              AND eligibility = 'eligible'
              AND qualification <> 'turnstile_verified_browser'`
        : null
      const botVerified =
        livePublic &&
        experiment.liveEvidence != null &&
        policy.authority === "prelaunch_agreed" &&
        safe(verifiedQualificationRows?.[0]?.unverified ?? 0n) === 0
      const webComplete =
        livePublic &&
        web?.status === "complete" &&
        web.startHour === experiment.startsAt.toISOString() &&
        web.endHourExclusive === finalAt.toISOString() &&
        web.missingHours.length === 0 &&
        web.imbalancedHours.length === 0 &&
        web.counters.delivery_qualified >= eligibleVisits &&
        web.counters.click_ack >= acceptedSelections &&
        web.counters.click_unavailable === 0 &&
        web.counters.delivery_verification_unavailable === 0
      const isFinal = asOf >= finalAt
      const evaluation = evaluatePrecomputedCtr(settings, {
        startsAt: experiment.startsAt,
        endsAt: experiment.endsAt,
        asOf,
        byArm: moments,
        botEligibility:
          input.evidenceBasis === "isolated_fixture" || botVerified
            ? "verified"
            : "unverified",
        trackingLoss:
          input.evidenceBasis === "isolated_fixture"
            ? "verified"
            : "unobservable",
      })
      const reasons = [...evaluation.reasons]
      if (
        input.evidenceBasis === "private_unverified" &&
        policy.authority !== "prelaunch_agreed"
      )
        reasons.push("numeric_policy_not_agreed")
      if (
        input.evidenceBasis === "isolated_fixture" &&
        policy.authority !== "fixture_only"
      )
        reasons.push("fixture_policy_authority_mismatch")
      if (livePublic && policy.authority !== "prelaunch_agreed")
        reasons.push("numeric_policy_not_agreed")
      if (livePublic && !botVerified)
        reasons.push("live_browser_qualification_unverified")
      if (livePublic && !webComplete)
        reasons.push("web_request_health_incomplete")
      if (livePublic) reasons.push("experiment_scoped_tracking_loss_unverified")
      const unversioned = safe(
        totals.control.unversionedArchivedVisits +
          totals.challenger.unversionedArchivedVisits +
          totals.excluded.unversionedArchivedVisits,
      )
      if (unversioned) reasons.push("archived_without_predeclared_policy")
      const revision = (latest?.revision ?? 0) + 1
      const report: PrecomputedCtrReport = {
        schemaVersion: 1,
        evidenceBasis: livePublic
          ? "live_incomplete"
          : (input.evidenceBasis as "private_unverified" | "isolated_fixture"),
        experimentId: experiment.id,
        revision,
        isFinal,
        asOf: asOf.toISOString(),
        generationId: experiment.generationId,
        controlManifestId: experiment.controlManifestId,
        controlManifestDigest: experiment.controlManifestDigest,
        controlRoutingDigest: experiment.controlRoutingDigest,
        sourceSetDigest: experiment.sourceSetDigest,
        configurationDigest: experiment.configurationDigest,
        ...(livePublic &&
        experiment.liveEvidence &&
        typeof experiment.liveEvidence === "object" &&
        !Array.isArray(experiment.liveEvidence)
          ? {
              liveLaunchEvidence: {
                evidenceDigest: String(
                  (experiment.liveEvidence as Record<string, unknown>)
                    .evidenceDigest ?? "",
                ),
                baselineReportDigest: String(
                  (experiment.liveEvidence as Record<string, unknown>)
                    .baselineReportDigest ?? "",
                ),
                launchCapacityReceiptDigest: String(
                  (experiment.liveEvidence as Record<string, unknown>)
                    .launchCapacityReceiptDigest ?? "",
                ),
                authoritativeCatalogSourceSetDigest: String(
                  (experiment.liveEvidence as Record<string, unknown>)
                    .authoritativeCatalogSourceSetDigest ?? "",
                ),
              },
            }
          : {}),
        eligibilityPolicyVersion: experiment.eligibilityPolicyVersion,
        policy: {
          version: policy.version,
          method: METHOD,
          digest: policy.settingsDigest,
          authority: policy.authority as "fixture_only" | "prelaunch_agreed",
          settings,
        },
        cohort: {
          startsAt: experiment.startsAt.toISOString(),
          endsAt: experiment.endsAt.toISOString(),
          finalAt: finalAt.toISOString(),
        },
        byArm: {
          control: armReport(
            totals.control,
            moments.control,
            evaluation.effectiveBrowsers.control,
          ),
          challenger: armReport(
            totals.challenger,
            moments.challenger,
            evaluation.effectiveBrowsers.challenger,
          ),
        },
        exclusions: {
          automation: safe(totals.excluded.excludedAutomation),
          preview: safe(totals.excluded.excludedPreview),
          unknown: safe(totals.excluded.excludedUnknown),
          outsideCohort: safe(totals.excluded.excludedOutsideCohort),
          other: safe(totals.excluded.excludedOther),
        },
        measurementHealth: {
          botEligibility:
            input.evidenceBasis === "isolated_fixture"
              ? "fixture_verified"
              : botVerified
                ? "durable_rows_verified"
                : "unverified",
          trackingLoss:
            input.evidenceBasis === "isolated_fixture"
              ? "fixture_verified"
              : "unobservable",
          ...(livePublic
            ? { endToEndClientEventCompleteness: "unverified" as const }
            : {}),
          ...(livePublic
            ? {
                webRequestHealth: {
                  status: web?.status ?? "unavailable",
                  requestedHours:
                    web && web.status !== "unavailable"
                      ? web.requestedHours
                      : 0,
                  coveredHours:
                    web && web.status !== "unavailable" ? web.coveredHours : 0,
                  missingHourCount:
                    web && web.status !== "unavailable"
                      ? web.missingHours.length
                      : 0,
                  imbalancedHourCount:
                    web && web.status !== "unavailable"
                      ? web.imbalancedHours.length
                      : 0,
                  qualifiedRequestAttempts:
                    web && web.status !== "unavailable"
                      ? web.counters.delivery_qualified
                      : 0,
                  clickAcknowledgements:
                    web && web.status !== "unavailable"
                      ? web.counters.click_ack
                      : 0,
                  clickUnavailable:
                    web && web.status !== "unavailable"
                      ? web.counters.click_unavailable
                      : 0,
                  verificationUnavailable:
                    web && web.status !== "unavailable"
                      ? web.counters.delivery_verification_unavailable
                      : 0,
                },
              }
            : {}),
          edgeAutomationCoverage: "partial_unverified",
          exclusionCountScope: "admin_bound_only",
          unversionedArchivedVisits: unversioned,
          attribution: "server_bound_request_and_item",
        },
        uncertainty: {
          method: METHOD,
          clusterCorrection: "m_over_m_minus_1",
          confidence: 0.95,
          difference: evaluation.difference,
          standardError: evaluation.standardError,
          lowerBound: evaluation.lowerBound,
          upperBound: evaluation.upperBound,
          criticalValue: evaluation.criticalValue,
          conservativeDegreesOfFreedom: evaluation.conservativeDegreesOfFreedom,
        },
        outcome:
          (input.evidenceBasis === "isolated_fixture" || livePublic) &&
          reasons.length === 0
            ? evaluation.outcome
            : "inconclusive",
        reasons,
      }
      // All retained counts are checked as safe integers before hashing and
      // serializing a revision; no raw visitor or event stream enters the report.
      const serializedDigest = digest({
        report: {
          ...report,
          revision: 0,
          asOf: "",
        },
        isFinal,
      })
      if (
        latest?.evidenceDigest === serializedDigest &&
        latest.isFinal === isFinal
      )
        return {
          status: "available",
          report: latest.result as unknown as PrecomputedCtrReport,
        } as const
      // At most 32 immutable provisional snapshots, reserving revision 33 for
      // the one fixed-horizon final result. Excess interim reads say so plainly.
      if (latest && latest.revision >= (isFinal ? 33 : 32))
        return {
          status: "unavailable",
          reason: "provisional_revision_capacity_exhausted",
        } as const
      const stored = await tx.recommendationPrecomputedCtrReport.create({
        data: {
          experimentId: experiment.id,
          revision,
          policyDigest: policy.settingsDigest,
          evidenceDigest: serializedDigest,
          asOf,
          isFinal,
          result: report as unknown as Prisma.InputJsonValue,
        },
      })
      return {
        status: "available",
        report: stored.result as unknown as PrecomputedCtrReport,
      } as const
    },
    { timeout: 30_000, maxWait: 5_000 },
  )
}

/** Existing private data remains permanently unqualified for public wins. */
export function evaluatePrivatePrecomputedCtr(
  prisma: PrismaClient,
  input: { experimentId: string; operator: Principal | null; now?: Date },
): Promise<PrecomputedCtrRead> {
  return evaluatePrecomputedCtrReport(prisma, {
    ...input,
    evidenceBasis: "private_unverified",
  })
}

/** Global Web request counters expose telemetry gaps, but cannot prove every
 * eligible experiment visit/click was attributed. A live report can close at
 * the fixed horizon while remaining inconclusive until scoped proof exists. */
export async function evaluatePublicPrecomputedCtr(
  prisma: PrismaClient,
  input: { experimentId: string; operator: Principal | null; now?: Date },
): Promise<PrecomputedCtrRead> {
  const experiment =
    await prisma.recommendationPrecomputedExperiment.findUnique({
      where: { id: input.experimentId },
      include: { ctrPolicy: true },
    })
  const now = input.now ?? new Date()
  const livePublic =
    experiment?.eligibilityPolicyVersion ===
    (await import("./public-control"))
      .PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY
  let webMeasurement: WebWatchMeasurementRead | null = null
  if (livePublic && experiment?.ctrPolicy) {
    const finalAt = new Date(
      experiment.endsAt.getTime() +
        experiment.ctrPolicy.lateEventCutoffHours * 3_600_000,
    )
    const completedHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
    const end = new Date(Math.min(finalAt.getTime(), completedHour))
    if (end > experiment.startsAt)
      webMeasurement = await loadWebWatchMeasurement(experiment.startsAt, end, {
        now,
      })
  }
  return evaluatePrecomputedCtrReport(prisma, {
    ...input,
    now,
    evidenceBasis: livePublic ? "live_public" : "isolated_fixture",
    webMeasurement,
  })
}

/** Admin and authenticated AI route use this exact versioned read contract. */
export async function loadPrivatePrecomputedCtrReport(
  prisma: PrismaClient,
  input: {
    experimentId: string
    revision?: number
    reviewer: Principal | null
  },
): Promise<PrecomputedCtrRead> {
  if (!hasPermission(input.reviewer, "read:recommendation-aggregates"))
    throw new ForbiddenError()
  const row =
    input.revision == null
      ? await prisma.recommendationPrecomputedCtrReport.findFirst({
          where: { experimentId: input.experimentId },
          orderBy: { revision: "desc" },
        })
      : await prisma.recommendationPrecomputedCtrReport.findUnique({
          where: {
            experimentId_revision: {
              experimentId: input.experimentId,
              revision: input.revision,
            },
          },
        })
  return row
    ? {
        status: "available",
        report: row.result as unknown as PrecomputedCtrReport,
      }
    : { status: "unavailable", reason: "report_not_found" }
}

/** The dashboard reads policy existence and a bounded revision index through
 * the same aggregate permission boundary as the report itself. */
export async function loadPrivatePrecomputedCtrIndex(
  prisma: PrismaClient,
  input: { experimentId: string; reviewer: Principal | null },
): Promise<PrecomputedCtrIndex> {
  if (!hasPermission(input.reviewer, "read:recommendation-aggregates"))
    throw new ForbiddenError()
  const [experiment, policy, revisions] = await Promise.all([
    prisma.recommendationPrecomputedExperiment.findUnique({
      where: { id: input.experimentId },
      select: { state: true },
    }),
    prisma.recommendationPrecomputedCtrPolicy.findUnique({
      where: { experimentId: input.experimentId },
      select: { experimentId: true },
    }),
    prisma.recommendationPrecomputedCtrReport.findMany({
      where: { experimentId: input.experimentId },
      select: { revision: true, isFinal: true, asOf: true },
      orderBy: { revision: "desc" },
      take: 33,
    }),
  ])
  if (policy)
    return {
      policyDeclared: true,
      canDeclarePolicy: false,
      declarationUnavailableReason: null,
      revisions,
    }
  if (experiment?.state !== "private_test")
    return {
      policyDeclared: false,
      canDeclarePolicy: false,
      declarationUnavailableReason: "experiment_unavailable",
      revisions,
    }
  const [rawVisit, archivedVisit] = await Promise.all([
    prisma.recommendationPrecomputedVisit.findFirst({
      where: { experimentId: input.experimentId },
      select: { id: true },
    }),
    prisma.recommendationPrecomputedCtrArchivedVisit.findFirst({
      where: { experimentId: input.experimentId },
      select: { visitId: true },
    }),
  ])
  return {
    policyDeclared: false,
    canDeclarePolicy: !rawVisit && !archivedVisit,
    declarationUnavailableReason:
      rawVisit || archivedVisit ? "visits_exist" : null,
    revisions,
  }
}
