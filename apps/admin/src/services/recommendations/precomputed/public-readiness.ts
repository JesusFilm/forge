import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "@/services/errors"
import {
  assertIsolatedPrecomputedControlFixture,
  loadPrecomputedPublicControl,
} from "./public-control"
import { readControlRouting } from "./visit-admission"
import {
  loadPrecomputedIncumbentBaseline,
  loadPrecomputedIncumbentBaselineReport,
} from "./incumbent-baseline"

const experimentSelect = {
  id: true,
  generationId: true,
  configurationDigest: true,
  controlRoutingDigest: true,
  sourceSetDigest: true,
  startsAt: true,
  endsAt: true,
  expiresAt: true,
  ctrReports: {
    take: 1,
    orderBy: { revision: "desc" as const },
    select: {
      revision: true,
      isFinal: true,
      evidenceDigest: true,
      result: true,
    },
  },
} as const

/** Read-only operator snapshot. A completed build, a fixture win, and an
 * observed traffic count never constitute a live launch certificate. */
export async function loadPrecomputedPublicReadiness(
  prisma: PrismaClient,
  reviewer: Principal | null,
) {
  if (!hasPermission(reviewer, "read:recommendation-aggregates"))
    throw new ForbiddenError()
  const control = await loadPrecomputedPublicControl(prisma)
  const [routing, generations, experiments, baseline] = await Promise.all([
    readControlRouting(prisma),
    prisma.recommendationPrecomputedGeneration.findMany({
      where: { status: "complete" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        status: true,
        protocolVersion: true,
        sourceSetDigest: true,
        expectedSourceCount: true,
        capacityPreflight: true,
        completedAt: true,
      },
    }),
    prisma.recommendationPrecomputedExperiment.findMany({
      where: { state: "public_ready" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: experimentSelect,
    }),
    loadPrecomputedIncumbentBaseline(prisma),
  ])
  const baselineReport = baseline
    ? await loadPrecomputedIncumbentBaselineReport(prisma, baseline.id)
    : null
  const retained =
    control.retainedExperimentId &&
    !experiments.some((item) => item.id === control.retainedExperimentId)
      ? await prisma.recommendationPrecomputedExperiment.findUnique({
          where: { id: control.retainedExperimentId },
          select: experimentSelect,
        })
      : null
  let fixtureRehearsalEnvironment = false
  try {
    await assertIsolatedPrecomputedControlFixture(prisma)
    fixtureRehearsalEnvironment = true
  } catch {
    // Readiness remains available on ordinary production databases.
  }
  return {
    schemaVersion: 1 as const,
    control,
    baseline,
    baselineReport,
    incumbentRouting: routing
      ? {
          manifestId: routing.manifest.id,
          routingDigest: routing.routingDigest,
        }
      : null,
    generations,
    experiments: [...experiments, ...(retained ? [retained] : [])].map(
      ({ ctrReports, ...item }) => ({
        ...item,
        latestReport: ctrReports[0] ?? null,
      }),
    ),
    fixtureRehearsalEnvironment,
    liveActivation: {
      status: "blocked" as const,
      reason:
        "authenticated_live_measurement_verifier_not_implemented" as const,
      unresolved: [
        "deployed_ga_and_model_access_unverified",
        "trusted_human_and_bot_signal_unverified",
        "web_edge_exclusion_coverage_partial_unverified",
        "visit_id_and_browser_identity_loss_audit_unverified",
        "numeric_stopping_policy_not_agreed_for_live_traffic",
        "physical_headroom_and_traffic_projection_unverified",
        "first_actual_catalog_cost_and_coverage_not_reviewed",
      ],
    },
  }
}
