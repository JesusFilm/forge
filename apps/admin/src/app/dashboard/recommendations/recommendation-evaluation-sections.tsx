import { PageSection, StatusPill } from "@/components/admin-ui"
import type { RecommendationOverviewData } from "@/services/recommendations/admin-ops"
import {
  displayRecommendationToken,
  formatRecommendationCount as formatCount,
  formatRecommendationDateTime,
  formatRecommendationPercent as formatPercent,
  recommendationNumberFrom as numberFrom,
} from "./recommendation-display"
import { PromotionControls } from "./PromotionControls"

export function ProfileShadowEvaluation({
  overview,
}: {
  overview: RecommendationOverviewData
}) {
  const profile = overview.profileShadow
  if (!profile) {
    return (
      <PageSection title="Profile candidate shadow" meta="U19 / SHADOW ONLY">
        <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
          No retained multi-interest profile projection evidence is available.
          Live Watch recommendations remain on semantic control.
        </p>
      </PageSection>
    )
  }
  const evaluation = profile.evaluation
  const decisionTone =
    evaluation?.decision === "PROMOTE_TO_EXPERIMENT"
      ? "success"
      : evaluation?.state === "terminal"
        ? "warning"
        : "muted"
  return (
    <PageSection
      title="Profile candidate shadow"
      meta="MULTI-INTEREST / AGGREGATE ONLY / NO LIVE TRAFFIC"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={profile.manifestEnabled ? "success" : "danger"}>
              {profile.manifestEnabled ? "Manifest published" : "Unavailable"}
            </StatusPill>
            <StatusPill tone="muted">Shadow only</StatusPill>
            {evaluation ? (
              <StatusPill tone={decisionTone}>
                {evaluation.decision
                  ? displayRecommendationToken(evaluation.decision)
                  : displayRecommendationToken(evaluation.state)}
              </StatusPill>
            ) : null}
          </div>
          <p className="mt-3 max-w-3xl text-[13px] text-[var(--color-text-secondary)]">
            Distinct durable interests and short-lived session intent are
            evaluated against the immutable semantic slate. This evidence cannot
            change Watch delivery or the 1.5 second contract.
          </p>
          {evaluation?.reevaluationCondition ? (
            <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
              Next evidence: {evaluation.reevaluationCondition}
            </p>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-[var(--color-text-muted)] uppercase">
          {profile.manifestId}
        </span>
      </div>
      <div className="grid gap-px border-t border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-6">
        <Definition
          label="Projection builds"
          value={formatCount(profile.generationCount)}
        />
        <Definition
          label="Durable builds"
          value={formatCount(profile.durableGenerationCount)}
        />
        <Definition
          label="Session builds"
          value={formatCount(profile.sessionGenerationCount)}
        />
        <Definition
          label="Projection failures"
          value={formatCount(profile.failedRunCount)}
        />
        <Definition label="Coverage" value={formatPercent(profile.coverage)} />
        <Definition
          label="Stability"
          value={formatPercent(profile.stability)}
        />
      </div>
      {profile.metricsSuppressed ? (
        <p className="border-t border-[var(--color-hairline)] px-4 py-3 text-[11px] text-[var(--color-text-muted)]">
          Per-interest quality is privacy-suppressed until at least three
          projection builds exist in this window.
        </p>
      ) : profile.interests.length > 0 ? (
        <div className="grid gap-px border-t border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-5">
          {profile.interests.map((interest) => (
            <Definition
              key={`${interest.kind}:${interest.ordinal}`}
              label={`${displayRecommendationToken(interest.kind)} ${interest.ordinal + 1}`}
              value={`${formatCount(interest.generations)} builds · ${formatPercent(interest.stability)} stable`}
            />
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 border-t border-[var(--color-hairline)] p-4 lg:grid-cols-3">
        <div>
          <div className="label-text">Projection watermarks</div>
          <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
            Input {formatRecommendationDateTime(profile.inputWatermark)} · next
            expiry {formatRecommendationDateTime(profile.expiryWatermark)}
          </p>
        </div>
        <div>
          <div className="label-text">Counterfactual quality</div>
          <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
            Coverage {formatPercent(evaluation?.coverage ?? null)} · novelty{" "}
            {formatPercent(evaluation?.novelty ?? null)} · overlap{" "}
            {formatPercent(evaluation?.overlap ?? null)} · diversity{" "}
            {formatPercent(evaluation?.diversity ?? null)}
          </p>
        </div>
        <div>
          <div className="label-text">Evaluation cohort</div>
          <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
            {formatCount(evaluation?.processedCount)} processed ·{" "}
            {formatCount(evaluation?.failedCount)} failed · p95{" "}
            {evaluation?.latencyP95Ms == null
              ? "Unknown"
              : `${evaluation.latencyP95Ms} ms`}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            Terminal decision only authorizes a later experiment; live semantic
            remains unchanged.
          </p>
        </div>
      </div>
    </PageSection>
  )
}

export function PromotionDecision({
  overview,
  canOperate,
}: {
  overview: RecommendationOverviewData
  canOperate: boolean
}) {
  const promotion = overview.promotion
  if (!promotion) {
    return (
      <PageSection title="Promotion decision" meta="SAFE DEFAULT / UNAVAILABLE">
        <div className="p-4">
          <StatusPill tone="warning">Unavailable fallback state</StatusPill>
          <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
            Promotion state cannot be verified. No challenger activation is
            allowed; semantic control remains the safe default.
          </p>
        </div>
      </PageSection>
    )
  }
  const workflow = promotion.workflow
  const stageTone = promotion.killSwitchEnabled
    ? "danger"
    : promotion.stage === "control"
      ? "muted"
      : "success"
  return (
    <PageSection
      title="Promotion decision"
      meta={`GENERATION ${promotion.generation} / IMMUTABLE AUDIT`}
    >
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={stageTone}>
              {promotion.killSwitchEnabled
                ? "Emergency hold"
                : displayRecommendationToken(promotion.stage)}
            </StatusPill>
            <StatusPill
              tone={promotion.readiness.ready ? "success" : "warning"}
            >
              {promotion.readiness.ready ? "Ready" : "Not ready"}
            </StatusPill>
            {workflow ? (
              <StatusPill
                tone={
                  workflow.state === "failed" || workflow.state === "stale"
                    ? "danger"
                    : workflow.state === "complete"
                      ? "success"
                      : "warning"
                }
              >
                Workflow {displayRecommendationToken(workflow.state)}
              </StatusPill>
            ) : null}
          </div>
          <h3 className="mt-4 text-base font-medium">
            {promotion.readiness.nextAction}
          </h3>
          <p className="mt-2 max-w-3xl text-[13px] text-[var(--color-text-secondary)]">
            {promotion.readiness.reason}
          </p>
          <div className="mt-4 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3 text-[12px]">
            <div className="label-text">Impact preview</div>
            <p className="mt-2 text-[var(--color-text-secondary)]">
              {promotion.readiness.impact}
            </p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              Failure restores{" "}
              <span className="font-mono">{promotion.readiness.restore}</span>
              {promotion.fallbackAvailable
                ? ", fences assignments, stored slates and pending workflows, and clears candidate caches."
                : ". Warning: this fallback manifest is currently unavailable."}
            </p>
          </div>
        </div>
        <dl className="grid content-start gap-3 text-[12px]">
          <div>
            <dt className="label-text">Active strategy</dt>
            <dd className="mt-1 break-all font-mono text-[var(--color-text-secondary)]">
              {promotion.activeManifestId}
            </dd>
          </div>
          <div>
            <dt className="label-text">Approved ceiling</dt>
            <dd className="mt-1 text-[var(--color-text-secondary)]">
              {promotion.approval
                ? `${promotion.approval.maxExposureBps / 100}% · digest ${promotion.approval.manifestDigest.slice(0, 12)}`
                : "No exact approval"}
            </dd>
          </div>
          <div>
            <dt className="label-text">Mature guardrails</dt>
            <dd className="mt-1 text-[var(--color-text-secondary)]">
              {promotion.evaluationState
                ? displayRecommendationToken(promotion.evaluationState)
                : "No retained evaluation"}
            </dd>
          </div>
          <div>
            <dt className="label-text">Conflicts / stale claims</dt>
            <dd className="mt-1 text-[var(--color-text-secondary)]">
              {promotion.conflictCount}
              {workflow?.failureReason
                ? ` · ${displayRecommendationToken(workflow.failureReason)}`
                : ""}
            </dd>
          </div>
        </dl>
      </div>
      <div className="border-t border-[var(--color-hairline)] p-4">
        {canOperate ? (
          <PromotionControls
            generation={promotion.generation}
            stage={promotion.stage}
            targetManifestId={promotion.targetManifestId}
            lastKnownGoodManifestId={promotion.lastKnownGoodManifestId}
            approvalId={promotion.approval?.id ?? null}
            evaluationId={promotion.evaluationId}
            exposureCeilingBps={promotion.exposureCeilingBps}
            proposedExposureCeilingBps={promotion.proposedExposureCeilingBps}
            killSwitchEnabled={promotion.killSwitchEnabled}
            ready={promotion.readiness.ready}
          />
        ) : (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Read-only evidence. Promotion controls require Admin authority.
          </p>
        )}
      </div>
      <div className="border-t border-[var(--color-hairline)]">
        <div className="px-4 pt-4 label-text">Recent immutable audit</div>
        {promotion.audit.length ? (
          <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
            {promotion.audit.map((event) => (
              <li
                key={event.id}
                className="grid gap-1 px-4 py-3 text-[12px] md:grid-cols-[180px_1fr_auto]"
              >
                <span className="font-medium">
                  {displayRecommendationToken(event.eventType)}
                </span>
                <span className="break-all text-[var(--color-text-secondary)]">
                  {event.fromManifestId ?? "none"} → {event.toManifestId} ·{" "}
                  {displayRecommendationToken(event.reasonCode)}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  G{event.pointerGeneration} ·{" "}
                  {formatRecommendationDateTime(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-[12px] text-[var(--color-text-muted)]">
            No promotion decisions have been recorded yet.
          </p>
        )}
      </div>
    </PageSection>
  )
}

export function ExperimentEvaluation({
  overview,
}: {
  overview: RecommendationOverviewData
}) {
  const evaluation = overview.experimentEvaluation
  if (!evaluation) {
    return (
      <PageSection
        title="Semantic A/A experiment"
        meta="ASSIGNMENT / EXPOSURE / MULTI-OUTCOME"
      >
        <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
          No retained experiment evaluation is available yet. Semantic control
          remains the serving fallback.
        </p>
      </PageSection>
    )
  }
  const controlAssigned = numberFrom(evaluation.counts, "controlAssigned")
  const challengerAssigned = numberFrom(evaluation.counts, "challengerAssigned")
  const controlExposed = numberFrom(evaluation.counts, "controlExposed")
  const challengerExposed = numberFrom(evaluation.counts, "challengerExposed")
  const controlQualified = nestedNumber(
    evaluation.intentToTreat,
    "control",
    "qualifiedRate",
  )
  const challengerQualified = nestedNumber(
    evaluation.intentToTreat,
    "challenger",
    "qualifiedRate",
  )
  const srmHealthy = booleanFrom(evaluation.sampleRatio, "healthy")
  const errorGuardrail = booleanFrom(evaluation.guardrails, "passed")
  return (
    <PageSection
      title="Semantic A/A experiment"
      meta={
        "REVISION " + evaluation.revision + " / ITT PRIMARY / ACTUAL EXPOSURE"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusPill
              tone={
                evaluation.state === "pass"
                  ? "success"
                  : evaluation.state === "inconclusive"
                    ? "warning"
                    : "danger"
              }
            >
              {displayRecommendationToken(evaluation.state)}
            </StatusPill>
            <StatusPill tone={srmHealthy ? "success" : "danger"}>
              Sample ratio {srmHealthy ? "healthy" : "unhealthy"}
            </StatusPill>
            <StatusPill tone={errorGuardrail ? "success" : "danger"}>
              Playback guardrail {errorGuardrail ? "passed" : "failed"}
            </StatusPill>
          </div>
          <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
            Sticky assignment probability{" "}
            {formatPercent(evaluation.expectedChallengerProbability)} ·{" "}
            {evaluation.controlManifestId} versus{" "}
            {evaluation.challengerManifestId}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {evaluation.reasonCodes.map(displayRecommendationToken).join(" · ")}
          </p>
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-muted)] uppercase">
          Evaluated {formatRecommendationDateTime(evaluation.evaluatedAt)}
          {evaluation.supersedesRevision == null
            ? ""
            : " · supersedes revision " + evaluation.supersedesRevision}
        </div>
      </div>
      <div className="grid gap-px border-t border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-6">
        <Definition
          label="Control assigned"
          value={formatCount(controlAssigned ?? undefined)}
        />
        <Definition
          label="Challenger assigned"
          value={formatCount(challengerAssigned ?? undefined)}
        />
        <Definition
          label="Control exposed"
          value={formatCount(controlExposed ?? undefined)}
        />
        <Definition
          label="Challenger exposed"
          value={formatCount(challengerExposed ?? undefined)}
        />
        <Definition
          label="Control qualified / ITT"
          value={formatPercent(controlQualified)}
        />
        <Definition
          label="Challenger qualified / ITT"
          value={formatPercent(challengerQualified)}
        />
      </div>
      <div className="grid gap-4 border-t border-[var(--color-hairline)] p-4 lg:grid-cols-3">
        <div>
          <div className="label-text">Closed input window</div>
          <p className="mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {formatRecommendationDateTime(evaluation.window.start)} →{" "}
            {formatRecommendationDateTime(evaluation.window.end)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            Snapshot{" "}
            {formatRecommendationDateTime(evaluation.window.inputCapturedAt)}
          </p>
        </div>
        <div>
          <div className="label-text">Source watermarks</div>
          <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
            Assignment{" "}
            {formatRecommendationDateTime(evaluation.watermarks.assignment)} ·
            exposure{" "}
            {formatRecommendationDateTime(evaluation.watermarks.exposure)} ·
            outcome{" "}
            {formatRecommendationDateTime(evaluation.watermarks.outcome)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            Mission{" "}
            {formatRecommendationDateTime(evaluation.watermarks.mission)} ·
            eligibility{" "}
            {formatRecommendationDateTime(evaluation.watermarks.eligibility)}
          </p>
        </div>
        <div>
          <div className="label-text">Pinned evidence contract</div>
          <p className="mt-2 break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
            {evaluation.versions.assignment} · {evaluation.versions.outcome} ·{" "}
            {evaluation.versions.integrity} · {evaluation.versions.evaluation}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {evaluation.retentionDays} days ·{" "}
            {displayRecommendationToken(evaluation.deletionBehavior)} ·{" "}
            {displayRecommendationToken(evaluation.fallbackBehavior)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
            Input {evaluation.inputDigest.slice(0, 12)}
          </p>
        </div>
      </div>
    </PageSection>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="label-text">{label}</div>
      <div className="mt-1 font-mono text-[12px] text-[var(--color-text-secondary)]">
        {value}
      </div>
    </div>
  )
}

function nestedNumber(
  value: Readonly<Record<string, unknown>>,
  group: string,
  key: string,
): number | null {
  const nested = value[group]
  if (!nested || typeof nested !== "object" || Array.isArray(nested))
    return null
  const entry = (nested as Record<string, unknown>)[key]
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null
}

function booleanFrom(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return value[key] === true
}
