import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  FileCheck2,
  Languages,
  Users,
} from "lucide-react"

import { SubtitleAssignmentControl } from "./subtitle-assignment-control"
import {
  formatSubtitleLabDate,
  presentAggregateMetrics,
  presentProviderEvidence,
} from "./subtitle-lab-operator-presenter"
import type {
  SubtitleLabAssignmentProgress,
  SubtitleLabReviewerCandidate,
  SubtitleLabRun,
} from "./subtitle-lab-operator-types"

const PANEL =
  "rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5 shadow-[0_8px_24px_rgba(17,17,17,0.04)]"

function safeFailureRows(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return []
    }
    const row = candidate as Record<string, unknown>
    if (typeof row.caseId !== "string") return []
    return [
      {
        caseId: row.caseId,
        targetLanguageId:
          typeof row.targetLanguageId === "string"
            ? row.targetLanguageId
            : "Not recorded",
        errorCode:
          typeof row.errorCode === "string" ? row.errorCode : "unknown_failure",
        attemptCount:
          typeof row.attemptCount === "number" ? row.attemptCount : null,
      },
    ]
  })
}

function MetricGroups({ title, value }: { title: string; value: unknown }) {
  const groups = presentAggregateMetrics(value)
  return (
    <section>
      <h3 className="text-base font-semibold">{title}</h3>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
          No completed machine assessments in this scope.
        </p>
      ) : (
        <div className="mt-2 grid gap-3">
          {groups.map((group) => (
            <article
              className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-3"
              key={group.key}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong dir="auto">{group.key}</strong>
                <span className="text-xs text-[color:var(--ds-muted)]">
                  n={group.sampleCount}
                </span>
              </div>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {group.metrics.map((metric) => (
                  <div key={metric.label}>
                    <dt className="font-mono text-xs text-[color:var(--ds-muted)]">
                      {metric.label}
                    </dt>
                    <dd className="mt-0.5 font-semibold">{metric.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function SubtitleRunReport({
  assignments,
  reviewerCandidates,
  run,
}: {
  assignments: SubtitleLabAssignmentProgress[]
  reviewerCandidates: SubtitleLabReviewerCandidate[]
  run: SubtitleLabRun
}) {
  const report = run.terminalReport
  const provider = presentProviderEvidence(report?.providerIdentities)
  const failures = safeFailureRows(report?.partialFailures)
  const submitted = assignments.filter(
    (assignment) => assignment.latestVerdict != null,
  ).length

  return (
    <section
      className="mx-auto grid w-full max-w-[1600px] gap-5 px-4 py-6 md:px-6"
      aria-labelledby="subtitle-run-title"
    >
      <a
        className="inline-flex w-fit items-center gap-2 text-sm font-semibold"
        href="/dashboard/subtitle-lab"
      >
        <ArrowLeft aria-hidden="true" size={17} /> Back to Subtitle Quality Lab
      </a>

      <header className={PANEL}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="studio-page-eyebrow">Immutable run evidence</span>
            <h1 className="mt-1 text-2xl font-semibold" id="subtitle-run-title">
              Subtitle evaluation run
            </h1>
            <p className="mt-1 break-all font-mono text-xs text-[color:var(--ds-muted)]">
              {run.id}
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-semibold">
            {run.status}
          </span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Created
            </dt>
            <dd className="mt-1">{formatSubtitleLabDate(run.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Terminal
            </dt>
            <dd className="mt-1">{formatSubtitleLabDate(run.terminalAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Requested model
            </dt>
            <dd className="mt-1 break-all">
              {run.requestedProvider} · {run.requestedModel}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Runtime
            </dt>
            <dd className="mt-1">
              {run.concurrency} concurrent · {run.timeoutSeconds}s ·{" "}
              {run.maxAttempts} attempts
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Prompt policy
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {run.promptPolicyId}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Workflow policy
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {run.workflowPolicyDigest}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Code revision
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {run.codeRevision}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Reserved spend
            </dt>
            <dd className="mt-1">{run.estimatedSpendMicros} µUSD</dd>
          </div>
        </dl>
      </header>

      {report ? (
        <section className={PANEL} aria-labelledby="terminal-report-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <FileCheck2 aria-hidden="true" size={19} />
              <div>
                <h2
                  className="text-xl font-semibold"
                  id="terminal-report-title"
                >
                  Immutable terminal report
                </h2>
                <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
                  Completed {formatSubtitleLabDate(report.completedAt)}
                </p>
              </div>
            </div>
            <span className="rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-semibold">
              {report.status}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
            <div>
              <dt className="font-semibold">Report SHA-256</dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {report.reportDigest}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Report artifact SHA-256</dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {report.reportArtifactDigest ?? "No retained report artifact"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Corpus identity</dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {report.corpusIdentityDigest}
              </dd>
            </div>
          </dl>
          {report.reproducibilityLimits.length > 0 ? (
            <div className="mt-4 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-hover)] p-3">
              <strong className="flex items-center gap-2 text-sm">
                <AlertTriangle aria-hidden="true" size={17} /> Reproducibility
                limits
              </strong>
              <ul className="mt-2 grid gap-1 pl-5 text-sm text-[color:var(--ds-muted)]">
                {report.reproducibilityLimits.map((limit) => (
                  <li className="list-disc" key={limit}>
                    {limit}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <section className={PANEL} role="status">
          <strong>Terminal report not available yet</strong>
          <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
            Mutable cell state is shown below. Recovery owns terminalization if
            the workflow is abandoned.
          </p>
        </section>
      )}

      <section className={PANEL} aria-labelledby="machine-evidence-title">
        <div className="flex items-center gap-2">
          <Bot aria-hidden="true" size={19} />
          <h2 className="text-xl font-semibold" id="machine-evidence-title">
            Machine evidence
          </h2>
        </div>
        <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
          Machine evidence does not count as human approval, specialist
          approval, or gold approval.
        </p>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <MetricGroups
            title="Per-language metrics"
            value={report?.languageMetrics}
          />
          <MetricGroups
            title="Per-collection metrics"
            value={report?.collectionMetrics}
          />
        </div>
        <section className="mt-6" aria-labelledby="provider-call-title">
          <h3 className="text-base font-semibold" id="provider-call-title">
            Provider call evidence
          </h3>
          <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
            {provider.requestedProvider} · {provider.requestedModel}. Identities
            and request digests only; provider response bodies are not retained
            here.
          </p>
          <div className="mt-2 overflow-x-auto rounded-[var(--ds-radius)] border border-[color:var(--ds-line)]">
            <table className="w-full min-w-[980px] border-collapse text-left text-xs">
              <thead className="bg-[color:var(--ds-hover)] uppercase tracking-wide text-[color:var(--ds-muted)]">
                <tr>
                  <th className="px-3 py-2">Cell</th>
                  <th className="px-3 py-2">Operation</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Requested / resolved model</th>
                  <th className="px-3 py-2">Provider request</th>
                  <th className="px-3 py-2">Provider response</th>
                  <th className="px-3 py-2">Request digest</th>
                </tr>
              </thead>
              <tbody>
                {provider.calls.map((call) => (
                  <tr
                    className="border-t border-[color:var(--ds-line)]"
                    key={providerCallEvidenceKey(call)}
                  >
                    <td className="px-3 py-2">
                      {call.caseId}
                      <span className="block font-mono text-[color:var(--ds-muted)]">
                        {call.targetLanguageId}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {call.operation} · attempt {call.operationAttempt}
                    </td>
                    <td className="px-3 py-2">{call.status}</td>
                    <td className="px-3 py-2">
                      {call.requestedModel}
                      <span className="block text-[color:var(--ds-muted)]">
                        {call.resolvedModel ?? "not exposed"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {call.providerRequestId ?? "not exposed"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {call.providerResponseId ?? "not exposed"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {call.requestDigest}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {provider.calls.length === 0 ? (
            <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
              No provider calls retained.
            </p>
          ) : null}
          {provider.omittedCallCount > 0 ? (
            <p className="mt-2 text-xs text-[color:var(--ds-muted)]">
              {provider.omittedCallCount} additional provider calls omitted by
              the UI bound.
            </p>
          ) : null}
        </section>
        {failures.length > 0 ? (
          <section className="mt-6" aria-labelledby="partial-failures-title">
            <h3 className="text-base font-semibold" id="partial-failures-title">
              Partial failures
            </h3>
            <div className="mt-2 grid gap-2">
              {failures.map((failure) => (
                <div
                  className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] p-3 text-sm"
                  key={`${failure.caseId}:${failure.targetLanguageId}`}
                >
                  <strong>{failure.errorCode}</strong>
                  <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
                    {failure.caseId} · {failure.targetLanguageId}
                    {failure.attemptCount == null
                      ? ""
                      : ` · ${failure.attemptCount} attempts`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <section className={PANEL} aria-labelledby="human-progress-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users aria-hidden="true" size={19} />
            <div>
              <h2 className="text-xl font-semibold" id="human-progress-title">
                Human review progress
              </h2>
              <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
                {submitted}/{assignments.length} assignment rounds have a human
                verdict.
              </p>
            </div>
          </div>
          <span className="rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-semibold">
            Separate from machine evidence
          </span>
        </div>
        <div className="mt-5 grid gap-4">
          {run.cells.map((cell) => (
            <article
              className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-4"
              key={cell.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong>{cell.caseId}</strong>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--ds-muted)]">
                    <Languages aria-hidden="true" size={14} />
                    <span dir="auto">{cell.targetLanguageSlug}</span>
                    <span className="font-mono">{cell.targetLanguageId}</span>
                    <span>· {cell.collectionKey}</span>
                  </p>
                </div>
                <span className="rounded-full border border-[color:var(--ds-line-strong)] px-2 py-0.5 text-xs">
                  {cell.status}
                </span>
              </div>
              {cell.errorCode ? (
                <p className="mt-3 flex items-center gap-2 text-sm">
                  <AlertTriangle aria-hidden="true" size={16} />{" "}
                  {cell.errorCode} ·{" "}
                  {cell.errorRetryable ? "retryable" : "terminal"}
                </p>
              ) : cell.assessmentDigest ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-[color:var(--ds-muted)]">
                  <CheckCircle2 aria-hidden="true" size={15} /> Machine
                  assessment {cell.assessmentDigest}
                </p>
              ) : null}
              <div className="mt-4">
                <SubtitleAssignmentControl
                  assignments={assignments}
                  cell={cell}
                  reviewerCandidates={reviewerCandidates}
                />
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

export function providerCallEvidenceKey(call: {
  caseId: string
  targetLanguageId: string
  leaseGeneration: number
  callSequence: number
}) {
  return `${call.caseId}:${call.targetLanguageId}:${call.leaseGeneration}:${call.callSequence}`
}
