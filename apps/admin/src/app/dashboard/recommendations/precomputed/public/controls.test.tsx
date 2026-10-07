import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { loadPrecomputedPublicReadiness } from "@/services/recommendations/precomputed/public-readiness"
import { PublicPrecomputedControls } from "./controls"

type Readiness = Awaited<ReturnType<typeof loadPrecomputedPublicReadiness>>

function readiness(fixture: boolean): Readiness {
  return {
    schemaVersion: 1,
    control: {
      mode: "incumbent",
      version: 1,
      experimentId: null,
      generationId: null,
      configurationDigest: null,
      controlRoutingDigest: null,
      sourceSetDigest: null,
      startsAt: null,
      endsAt: null,
      authority: null,
      reportRevision: null,
      reportEvidenceDigest: null,
      retainedExperimentId: null,
      pendingManualReview: null,
    },
    baseline: null,
    baselineReport: null,
    baselineCapacitySample: null,
    baselineWebMeasurement: null,
    launchCapacityReceipt: null,
    baselineFullHourWindow: false,
    baselineRequestToVisitGap: false,
    incumbentRouting: {
      manifestId: "incumbent-manifest",
      routingDigest: "a".repeat(64),
    },
    generations: [
      {
        id: "generation-1",
        inputDigest: "a".repeat(64),
        status: "complete",
        protocolVersion: 2,
        modelId: "fixture-astra",
        inputMode: "fixture",
        inputCutoff: new Date("2026-10-05T00:00:00.000Z"),
        historicalQualificationDigest: null,
        historicalQualification: null,
        sourceSetDigest: "b".repeat(64),
        expectedSourceCount: 1,
        capacityPreflight: { status: "passed" },
        completedAt: new Date("2026-10-06T00:00:00.000Z"),
      },
    ],
    experiments: [],
    authoritativeCatalogCoverage: null,
    fixtureRehearsalEnvironment: fixture,
    liveActivation: {
      status: "blocked",
      reason: "live_launch_evidence_incomplete",
      unresolved: ["trusted_human_and_bot_signal_unverified"],
    },
  }
}

describe("precomputed public operator controls", () => {
  it("does not offer public start or fixture preparation in an ordinary environment", () => {
    const html = renderToStaticMarkup(
      <PublicPrecomputedControls
        readiness={readiness(false)}
        canOperate
        canRollback
      />,
    )
    expect(html).toContain("incumbent")
    expect(html).not.toContain("Start fixture A/B")
    expect(html).not.toContain("Prepare cohort without serving")
  })

  it("offers only explicitly labeled fixture preparation in an owned fixture", () => {
    const html = renderToStaticMarkup(
      <PublicPrecomputedControls
        readiness={readiness(true)}
        canOperate
        canRollback
      />,
    )
    expect(html).toContain("Prepare an isolated rehearsal")
    expect(html).toContain("Fixture stopping policy JSON")
    expect(html).not.toContain("Start live A/B")
  })

  it("shows the stopped cohort and manual rollback after its month ends", () => {
    const data = readiness(true)
    data.control.version = 2
    data.control.pendingManualReview = {
      experimentId: "experiment-1",
      generationId: "generation-1",
      endsAt: "2026-11-06T00:00:00.000Z",
    }
    const html = renderToStaticMarkup(
      <PublicPrecomputedControls readiness={data} canOperate canRollback />,
    )
    expect(html).toContain("awaits manual evaluation and a decision")
    expect(html).toContain("Restore incumbent now")
    expect(html).not.toContain("Start fixture A/B")
  })

  it("shows primary counts but offers promotion only for a final fixture result", () => {
    const data = readiness(true)
    data.control.mode = "ab"
    data.control.experimentId = "experiment-1"
    data.control.generationId = "generation-1"
    const result = {
      outcome: "challenger",
      evidenceBasis: "private_unverified",
      reasons: [],
      byArm: {
        control: { eligibleVisits: 10, clickedVisits: 1, visitCtr: 0.1 },
        challenger: { eligibleVisits: 10, clickedVisits: 6, visitCtr: 0.6 },
      },
      measurementHealth: {
        edgeAutomationCoverage: "partial_unverified",
        experimentRequestHealth: {
          status: "complete",
          reconciliation: "no_observed_shortfall",
          attributedDeliveryAttempts: 24,
          acceptedVisitAttempts: 22,
          responseFailedAttempts: 1,
          clickAttempts: 9,
          clickAcknowledgements: 7,
          clickUnavailable: 2,
          clientNetworkLoss: "unobservable",
        },
      },
    }
    data.experiments.push({
      id: "experiment-1",
      generationId: "generation-1",
      configurationDigest: "a".repeat(64),
      controlRoutingDigest: "b".repeat(64),
      sourceSetDigest: "c".repeat(64),
      startsAt: new Date("2026-10-06T00:00:00.000Z"),
      endsAt: new Date("2026-10-07T00:00:00.000Z"),
      expiresAt: new Date("2027-10-07T00:00:00.000Z"),
      liveEvidence: null,
      ctrPolicy: null,
      latestReport: {
        revision: 1,
        isFinal: true,
        evidenceDigest: "d".repeat(64),
        result,
      },
    })
    const render = () =>
      renderToStaticMarkup(
        <PublicPrecomputedControls readiness={data} canOperate canRollback />,
      )
    const unverified = render()
    expect(unverified).toContain("Control: 1/10 clicked visits")
    expect(unverified).toContain("Web/edge bot exclusion coverage")
    expect(unverified).not.toContain("Promote exact fixture result")
    result.evidenceBasis = "isolated_fixture"
    expect(render()).toContain("Promote exact fixture result")
    result.evidenceBasis = "live_incomplete"
    const live = render()
    expect(live).toContain("24 attributed delivery attempts")
    expect(live).toContain("2 server-observed click failures")
    expect(live).toContain("browser or network events that never reached Web")
    expect(live).not.toContain("Promote exact fixture result")
  })
})
