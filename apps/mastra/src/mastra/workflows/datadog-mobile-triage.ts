import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { Pool } from "pg"
import { z } from "zod"

import {
  getDatadogTriageConfig,
  getDatadogTriageReadiness,
  getDatadogTriageServiceProfile,
  type DatadogTriageConfig,
} from "../../config/env"
import {
  analyzeTriageCandidate,
  type TriageAnalyzer,
} from "../../services/datadog-triage/analyze"
import { decideTriageAction } from "../../services/datadog-triage/action-policy"
import type {
  DatadogAggregate,
  DatadogIssuePage,
  DatadogIssueTrack,
  DatadogMonitorPage,
  DatadogResult,
} from "../../services/datadog-triage/datadog-client"
import { DatadogTriageClient } from "../../services/datadog-triage/datadog-client"
import {
  applyCandidateCap,
  detectIssueCandidates,
  detectMonitorSignals,
  detectSpikeSignals,
  resolveSourceWindow,
  type DetectionWindow,
  type TriageCandidate,
} from "../../services/datadog-triage/detect"
import { TriageLinearClient } from "../../services/datadog-triage/linear-client"
import {
  dispatchDueTriageActions,
  type TriageLinearActionClient,
} from "../../services/datadog-triage/linear-dispatcher"
import {
  PostgresDatadogTriageRepository,
  type CursorCommit,
  type DatadogTriageRepository,
} from "../../services/datadog-triage/repository"
import {
  cursorSource,
  emptyTriageRunCounters,
  triageRunReportSchema,
  type MonitorStateUpdate,
  type SeenIssueUpdate,
  type SpikeBaselineUpdate,
  type TriageRunCounters,
  type TriageRunReport,
  type TriageSourceOutcome,
} from "../../services/datadog-triage/schema"

const LEASE_MS = 30 * 60_000
/** Window a seeded source reads when its cursor is missing. */
const DEFAULT_LOOKBACK_MS = 60 * 60_000
/**
 * Aggregate ceiling on the judgment stage. The run key is the UTC hour, so a
 * run still executing when the next tick fires does NOT collide with it — both
 * claim, both pay for the same work. Bounding judgment keeps a run inside its
 * own hour; whatever does not fit is withheld and re-read next run.
 */
const JUDGMENT_BUDGET_MS = 20 * 60_000

/**
 * Distinct candidates failing to draft back to back reads as a dependency
 * outage rather than bad data, and every further candidate would pay for a
 * model call before hitting the same wall.
 */
const MAX_CONSECUTIVE_DRAFT_FAILURES = 3
/** The one spike class this version evaluates (R4: one bounded check). */
const SPIKE_CLASS = "error_rate"

export const DatadogMobileTriageInputSchema = z
  .object({
    /** Overrides the hourly run key. Manual re-runs only. */
    idempotencyKey: z.string().min(1).max(120).optional(),
  })
  .strict()

export type DatadogMobileTriageInput = z.infer<
  typeof DatadogMobileTriageInputSchema
>

/** The read surfaces the orchestrator needs, narrowed for testability. */
export type DatadogSourceClient = {
  searchIssues(input: {
    service: string
    track: DatadogIssueTrack
    from: Date
    to: Date
  }): Promise<DatadogResult<DatadogIssuePage>>
  listMonitors(input: {
    monitorTag: string
  }): Promise<DatadogResult<DatadogMonitorPage>>
  aggregateLogs(input: {
    query: string
    from: Date
    to: Date
  }): Promise<DatadogResult<DatadogAggregate>>
  aggregateRumEvents(input: {
    query: string
    from: Date
    to: Date
  }): Promise<DatadogResult<DatadogAggregate>>
}

export type DatadogTriageDependencies = {
  config: DatadogTriageConfig
  repository: DatadogTriageRepository
  datadog: DatadogSourceClient
  linear: TriageLinearActionClient
  analyzer: TriageAnalyzer
  now?: () => Date
  randomId?: () => string
}

function runKeyFor(now: Date, override?: string): string {
  return `datadog-triage:${override ?? now.toISOString().slice(0, 13)}`
}

/**
 * Plain-string structured log. Railway's logsV2 silences JSON-stringified
 * payloads from Node runtimes, and every value here is an enum or a count —
 * never upstream text, a query, or a credential.
 */
function logEvent(event: string, fields: Record<string, string | number>) {
  const pairs = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ")
  console.log(`[datadog-triage] event=${event} ${pairs}`.trim())
}

type SourceCollection = {
  candidates: TriageCandidate[]
  seenUpdates: SeenIssueUpdate[]
  monitorUpdates: MonitorStateUpdate[]
  spikeUpdates: SpikeBaselineUpdate[]
  cursors: CursorCommit[]
  outcomes: TriageSourceOutcome[]
  seededServices: string[]
  /** Widest range any source actually read, for the run report. */
  windowStart?: Date
  windowEnd?: Date
}

function emptyCollection(): SourceCollection {
  return {
    candidates: [],
    seenUpdates: [],
    monitorUpdates: [],
    spikeUpdates: [],
    cursors: [],
    outcomes: [],
    seededServices: [],
  }
}

/**
 * Fold a resolved source window into the run's reported range, and surface a
 * clamped window as a partial source so "catching up after an outage" is
 * distinguishable from "stuck" in the runbook's escalation query.
 */
function recordWindow(
  collection: SourceCollection,
  source: string,
  window: DetectionWindow,
  errors: string[],
): void {
  if (!collection.windowStart || window.from < collection.windowStart) {
    collection.windowStart = window.from
  }
  if (!collection.windowEnd || window.to > collection.windowEnd) {
    collection.windowEnd = window.to
  }
  if (window.clamped) {
    errors.push(`datadog:${source}:window_clamped`)
    collection.outcomes.push({
      source,
      status: "partial",
      reason: "window_clamped",
    })
  }
}

/**
 * The hourly sweep (U7, KTD1). Exported as a pure dependency-injected function
 * so the whole pipeline is testable without constructing a Mastra runtime.
 *
 * Order is load-bearing:
 *  1. Drain the outbox FIRST, unconditionally (R3) — retries and
 *     budget-deferred tickets must not wait for a new signal to appear.
 *  2. Fetch and detect per source, independently (KTD3).
 *  3. Judge, enqueue, dispatch.
 *  4. Commit state and cursors LAST (KTD2) — a crash before this re-processes
 *     the window next hour, which the outbox primary key absorbs.
 */
export async function executeDatadogTriage(
  rawInput: unknown,
  dependencies: DatadogTriageDependencies,
): Promise<TriageRunReport> {
  const parsedInput = DatadogMobileTriageInputSchema.safeParse(rawInput ?? {})
  const now = dependencies.now?.() ?? new Date()
  const config = dependencies.config
  const runKey = runKeyFor(
    now,
    parsedInput.success ? parsedInput.data.idempotencyKey : undefined,
  )
  const counters = emptyTriageRunCounters()
  const errors: string[] = []

  const readiness = getDatadogTriageReadiness(config)
  if (!readiness.ready) {
    // Flag off or incomplete config: return a typed disabled report without
    // constructing a run row or touching any client (R12).
    logEvent("run_disabled", {
      reasons: readiness.reasons.join(","),
    })
    return triageRunReportSchema.parse({
      runKey,
      status: "disabled",
      windowStart: now.toISOString(),
      windowEnd: now.toISOString(),
      counters,
      sources: [],
      issueUrls: [],
      errors: readiness.reasons.slice(0, 50),
    })
  }

  const leaseToken = dependencies.randomId?.() ?? randomUUID()
  const claim = await dependencies.repository.claimRun({
    runKey,
    windowStart: now,
    windowEnd: now,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
  })
  if (!claim.claimed) {
    logEvent("run_not_claimed", { status: claim.status })
    return triageRunReportSchema.parse({
      runKey,
      status: "already_running",
      windowStart: now.toISOString(),
      windowEnd: now.toISOString(),
      counters,
      sources: [],
      issueUrls: [],
      errors: [`run_not_claimed:${claim.status}`],
    })
  }

  const heartbeat = () =>
    dependencies.repository.renewRunLease({
      runKey,
      leaseToken,
      leaseDurationMs: LEASE_MS,
    })
  const issueUrls: string[] = []
  let partialReason: string | undefined

  try {
    // 1. Unconditional drain (R3/AE1): quiet hours still deliver retries.
    const drain = await dispatchDueTriageActions({
      repository: dependencies.repository,
      client: dependencies.linear,
      maxTicketsPerDay: config.maxTicketsPerDay,
      now,
      token: leaseToken,
      // Live clock: the SQL claim compares against the real now(), so a
      // frozen one lets one run burn several backoff rungs at once.
      clock: dependencies.now ?? (() => new Date()),
      heartbeat,
    })
    applyDispatch(counters, issueUrls, errors, drain)
    if (drain.failed > 0) partialReason ??= "dispatch_failed"

    // 2. Fetch and detect, per source.
    const collection = await collectSignals({
      dependencies,
      config,
      now,
      counters,
      errors,
      heartbeat,
    })
    counters.servicesCovered = config.services.length
    counters.servicesSeeded = collection.seededServices.length
    if (collection.outcomes.some((outcome) => outcome.status !== "ok")) {
      partialReason ??= "source_partial"
    }

    // 3. Cap, judge, enqueue.
    const capped = applyCandidateCap(
      collection.candidates,
      config.maxCandidatesPerRun,
      now,
    )
    counters.candidates = collection.candidates.length
    counters.candidatesCapped = capped.deferred.length
    // Every candidate this run did not resolve. Their detection state is
    // WITHHELD at commit time, so next hour re-reads them; committing it would
    // baseline a signal nobody ever looked at.
    const withheld: TriageCandidate[] = [...capped.deferred]
    const pins = emptyActionPins()
    // Elapsed REAL time, not a deadline derived from the injected clock: this
    // budget is about how long the stage actually runs, and mixing the two
    // clocks would make an injected `now` decide it before the first call.
    const judgmentStartedAt = Date.now()
    let consecutiveDraftFailures = 0

    for (const [index, candidate] of capped.judged.entries()) {
      if (Date.now() - judgmentStartedAt > JUDGMENT_BUDGET_MS) {
        // Out of time. Everything unjudged is withheld, so its state stays
        // uncommitted and its source cursor holds — the next run picks it up
        // rather than this one running into the following hour's tick.
        withheld.push(...capped.judged.slice(index))
        counters.candidatesCapped += capped.judged.length - index
        errors.push("judge:budget_exhausted")
        // `??=` everywhere: the FIRST reason a run went partial is the one an
        // operator needs, and a later stage must not overwrite it.
        partialReason ??= "judgment_budget_exhausted"
        break
      }
      await heartbeat()
      const analysis = await analyzeTriageCandidate({
        analyzer: dependencies.analyzer,
        candidate,
        abortSignal: AbortSignal.timeout(config.judgeTimeoutMs),
      })
      counters.judged += 1
      if (!analysis.ok) {
        counters.judgeFailures += 1
        errors.push(`judge:${analysis.reason}`)
        // A signal we could not judge must NOT have its state committed, or it
        // would be silently baselined and never looked at again.
        withheld.push(candidate)
        continue
      }
      // Drafting and enqueueing are bounded input operations, but a
      // deterministic throw here (an over-long id failing a schema bound, say)
      // would otherwise abort the whole sweep and do so again every hour.
      try {
        const decision = decideTriageAction({
          candidate,
          analysis: analysis.analysis,
          config: {
            confidenceThreshold: config.confidenceThreshold,
            actionabilityThreshold: config.actionabilityThreshold,
            minOccurrences: config.minOccurrences,
          },
          serviceProfile: getDatadogTriageServiceProfile(
            config,
            candidate.service,
          ),
          site: config.site,
          labelId: config.linear.bugLabelId,
        })
        if (decision.outcome === "suppress") {
          counters.suppressed += 1
          logEvent("candidate_suppressed", {
            service: candidate.service,
            kind: candidate.signalKind,
            reason: decision.reason,
          })
          continue
        }
        const inserted = await dependencies.repository.enqueueAction(
          decision.draft,
        )
        if (inserted) counters.actionsEnqueued += 1
        else counters.alreadyTicketed += 1
        recordActionPin(pins, candidate, decision.draft.idempotencyKey)
        consecutiveDraftFailures = 0
      } catch {
        counters.judgeFailures += 1
        consecutiveDraftFailures += 1
        // Fixed vocabulary only — a zod message would echo untrusted text.
        errors.push("draft:failed")
        withheld.push(candidate)
        if (consecutiveDraftFailures >= MAX_CONSECUTIVE_DRAFT_FAILURES) {
          // Back-to-back failures across distinct candidates read as a
          // dependency outage, and each remaining candidate would buy another
          // model call before hitting the same wall.
          withheld.push(...capped.judged.slice(index + 1))
          counters.candidatesCapped += capped.judged.length - index - 1
          errors.push("draft:systemic_failure")
          partialReason ??= "draft_systemic_failure"
          break
        }
      }
    }
    if (counters.judgeFailures > 0) {
      // ANY failure, matching the dispatch guards above. All-failed-only let a
      // deterministic per-candidate failure repeat hourly under `complete`,
      // because the candidates that did succeed kept the equality false.
      partialReason ??=
        counters.judgeFailures === counters.judged
          ? "judgment_failed"
          : "judgment_partial"
    }

    // 4. Dispatch what this run enqueued, so AE2's latency stays under an hour.
    if (counters.actionsEnqueued > 0) {
      const second = await dispatchDueTriageActions({
        repository: dependencies.repository,
        client: dependencies.linear,
        maxTicketsPerDay: config.maxTicketsPerDay,
        now,
        token: leaseToken,
        clock: dependencies.now ?? (() => new Date()),
        heartbeat,
      })
      applyDispatch(counters, issueUrls, errors, second)
      if (second.failed > 0) {
        // A dispatch that terminalized still commits the signal's state, so
        // the ticket is never filed and the signal is never re-detected. The
        // outbox row keeps the draft — the runbook's reclaim step re-sends it.
        partialReason ??= "dispatch_failed"
      }
    }

    // 5. Commit state, then cursors. Both carry the write-ordering guard, so a
    //    state row can never land ahead of the outbox row that justifies it.
    await commitDetectionState({
      repository: dependencies.repository,
      collection,
      withheld,
      pins,
      now,
    })
    await dependencies.repository.commitCursors(
      collection.cursors.map((cursor) => holdCursor(cursor, withheld)),
    )

    const report = triageRunReportSchema.parse({
      runKey,
      // The REAL range this run read, not the instant it started — this is the
      // only place an operator can answer "what did this run actually cover?".
      status: partialReason ? "partial" : "complete",
      windowStart: (collection.windowStart ?? now).toISOString(),
      windowEnd: (collection.windowEnd ?? now).toISOString(),
      counters,
      sources: collection.outcomes.slice(0, 60),
      issueUrls: issueUrls.slice(0, 25),
      errors: errors.slice(0, 50),
      partialReason,
    })
    await dependencies.repository.finalizeRun(report, leaseToken)
    logEvent("run_complete", {
      status: report.status,
      candidates: counters.candidates,
      enqueued: counters.actionsEnqueued,
      created: counters.actionsCreated,
      deferred: counters.actionsDeferred,
    })
    return report
  } catch (error) {
    // Name the error CLASS so an operator can tell a write-ordering refusal
    // from a database outage from a bug. Never the message — it can carry
    // upstream text.
    const errorName =
      error instanceof Error && /^[A-Za-z]{1,60}$/u.test(error.name)
        ? error.name
        : "non_error_throw"
    const failed = triageRunReportSchema.parse({
      runKey,
      status: "failed",
      windowStart: now.toISOString(),
      windowEnd: now.toISOString(),
      counters,
      sources: [],
      issueUrls: issueUrls.slice(0, 25),
      errors: [...errors, `unexpected_failure:${errorName}`].slice(0, 50),
      partialReason,
    })
    logEvent("run_failed", {
      candidates: counters.candidates,
      error: errorName,
    })
    try {
      await dependencies.repository.finalizeRun(failed, leaseToken)
    } catch {
      // The lease expires on its own; the next run takes over.
    }
    return failed
  }
}

/**
 * A source still holding unresolved candidates must not advance past the
 * earliest of them, or those signals are lost (KTD2). `commitCursors` clamps
 * with `greatest(stored, incoming)`, so a hold below the stored cursor just
 * leaves it put — and either way the next window, which reaches back by the
 * overlap, re-reads the withheld signal.
 */
function holdCursor(
  cursor: CursorCommit,
  withheld: TriageCandidate[],
): CursorCommit {
  const earliest = withheld
    .filter(
      (candidate) =>
        cursorSource(candidate.signalKind, candidate.service) === cursor.source,
    )
    .map((candidate) => Date.parse(candidate.occurredAt))
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => left - right)[0]
  if (earliest === undefined) return cursor
  // `succeeded` stays TRUE on purpose: the fetch worked and only judgment was
  // capped, and the liveness check reads last-success to find a dead source.
  // Setting it false here would report a healthy source as dead.
  return { ...cursor, cursorAt: new Date(earliest) }
}

function applyDispatch(
  counters: TriageRunCounters,
  issueUrls: string[],
  errors: string[],
  dispatch: {
    created: number
    deduplicated: number
    failed: number
    deferred: number
    issueUrls: string[]
    errors: string[]
  },
): void {
  counters.actionsCreated += dispatch.created
  counters.actionsDeduplicated += dispatch.deduplicated
  counters.actionsDeferred = dispatch.deferred
  counters.failures += dispatch.failed
  issueUrls.push(...dispatch.issueUrls)
  errors.push(...dispatch.errors.map((error) => `linear:${error}`))
}

/**
 * Outbox keys for the rows this run enqueued, keyed the way each commit path
 * looks itself up. One map per kind because the three state tables have three
 * different identities — keying them all by candidate `signalId` left the KTD2
 * guard permanently unarmed for monitors and spikes.
 */
export type ActionPins = {
  issues: Map<string, string>
  monitors: Map<string, string>
  spikes: Map<string, string>
}

function emptyActionPins(): ActionPins {
  return { issues: new Map(), monitors: new Map(), spikes: new Map() }
}

function spikePinKey(service: string, spikeClass: string): string {
  return `${service}:${spikeClass}`
}

function recordActionPin(
  pins: ActionPins,
  candidate: TriageCandidate,
  idempotencyKey: string,
): void {
  if (candidate.evidence.kind === "issue") {
    pins.issues.set(candidate.evidence.issueId, idempotencyKey)
    return
  }
  if (candidate.evidence.kind === "monitor") {
    pins.monitors.set(candidate.evidence.monitorId, idempotencyKey)
    return
  }
  pins.spikes.set(
    spikePinKey(candidate.service, candidate.evidence.spikeClass),
    idempotencyKey,
  )
}

/**
 * Commit detection state, minus anything this run could not resolve, and with
 * each resolved write pinned to the outbox row that justifies it (KTD2). The
 * repository refuses the whole batch if such a row is not durable yet, which
 * leaves the cursor unmoved and re-processes the window next hour.
 */
async function commitDetectionState(input: {
  repository: DatadogTriageRepository
  collection: SourceCollection
  withheld: TriageCandidate[]
  pins: ActionPins
  now: Date
}): Promise<void> {
  const withheldIssues = new Set(
    input.withheld
      .filter((candidate) => candidate.signalKind === "issue")
      .map((candidate) => candidate.signalId),
  )
  const withheldMonitors = new Set(
    input.withheld
      .filter((candidate) => candidate.evidence.kind === "monitor")
      .map((candidate) =>
        candidate.evidence.kind === "monitor"
          ? candidate.evidence.monitorId
          : "",
      ),
  )
  const withheldSpikes = new Set(
    input.withheld
      .filter((candidate) => candidate.evidence.kind === "spike")
      .map((candidate) =>
        candidate.evidence.kind === "spike"
          ? spikePinKey(candidate.service, candidate.evidence.spikeClass)
          : "",
      ),
  )

  await input.repository.commitSeenIssues(
    input.collection.seenUpdates
      .filter((update) => !withheldIssues.has(update.issueId))
      .map((update) => ({
        ...update,
        requiredActionKey: input.pins.issues.get(update.issueId),
      })),
  )
  await input.repository.commitMonitorStates(
    input.collection.monitorUpdates
      .filter((update) => !withheldMonitors.has(update.monitorId))
      .map((update) => {
        const requiredActionKey = input.pins.monitors.get(update.monitorId)
        return {
          ...update,
          requiredActionKey,
          // The cooldown stamp records "we FILED a ticket", not "we looked".
          // Stamping a suppressed candidate would blackout the monitor for
          // hours over a ticket that was never created.
          lastTicketedAt: requiredActionKey
            ? input.now.toISOString()
            : update.lastTicketedAt,
        }
      }),
  )
  await input.repository.commitSpikeBaselines(
    input.collection.spikeUpdates
      .filter(
        (update) =>
          !withheldSpikes.has(spikePinKey(update.service, update.spikeClass)),
      )
      .map((update) => {
        const requiredActionKey = input.pins.spikes.get(
          spikePinKey(update.service, update.spikeClass),
        )
        return {
          ...update,
          requiredActionKey,
          lastTicketedAt: requiredActionKey
            ? input.now.toISOString()
            : update.lastTicketedAt,
        }
      }),
  )
  await input.repository.seedServiceBaselines(
    input.collection.seededServices,
    input.now,
  )
}

async function collectSignals(input: {
  dependencies: DatadogTriageDependencies
  config: DatadogTriageConfig
  now: Date
  counters: TriageRunCounters
  errors: string[]
  /** Renews the run lease: the fetch phase can outlast it on its own. */
  heartbeat: () => Promise<void>
}): Promise<SourceCollection> {
  const { dependencies, config, now, counters, errors, heartbeat } = input
  const collection = emptyCollection()
  const seeded = new Set(
    await dependencies.repository.getSeededServices(config.services),
  )

  for (const service of config.services) {
    const alreadySeeded = seeded.has(service)
    const profile = getDatadogTriageServiceProfile(config, service)
    const lookbackMs = alreadySeeded
      ? DEFAULT_LOOKBACK_MS
      : config.baselineLookbackMs
    const sourceNames = [
      cursorSource("issue", service),
      cursorSource("monitor", service),
      cursorSource("spike", service),
    ]
    const cursors = new Map(
      (await dependencies.repository.getCursors(sourceNames)).map(
        (cursor) => [cursor.source, cursor] as const,
      ),
    )
    const windowFor = (source: string): DetectionWindow | undefined =>
      resolveSourceWindow({
        cursorAt: cursors.get(source)?.cursorAt,
        now,
        overlapMs: config.overlapMs,
        lagMs: config.ingestionLagMs,
        fallbackLookbackMs: lookbackMs,
      })

    let serviceSeeded = true

    // ── Error Tracking issues ────────────────────────────────────────────
    const issueSource = cursorSource("issue", service)
    const issueWindow = windowFor(issueSource)
    if (!issueWindow) {
      collection.outcomes.push({
        source: issueSource,
        status: "skipped",
        reason: "empty_window",
      })
    } else {
      recordWindow(collection, issueSource, issueWindow, errors)
      await heartbeat()
      const page = await dependencies.datadog.searchIssues({
        service,
        // The API requires a track; the profile's telemetry home names it.
        track: profile.spikeSource,
        from: issueWindow.from,
        to: issueWindow.to,
      })
      if (!page.ok) {
        serviceSeeded = false
        collection.outcomes.push({
          source: issueSource,
          status: "failed",
          reason: page.reason,
        })
        errors.push(`datadog:${issueSource}:${page.reason}`)
      } else {
        counters.signalsFetched += page.value.issues.length
        // Either flag means the page does not describe the whole window, so it
        // cannot seed a baseline: every issue it missed would arrive next run
        // as brand new and be ticketed, which is what F3/AE5 exists to prevent.
        const issueReadIncomplete =
          page.value.truncated || page.value.unparsedRows > 0
        if (page.value.unparsedRows > 0) {
          serviceSeeded = false
          errors.push(`datadog:${issueSource}:unparsed_rows`)
          collection.outcomes.push({
            source: issueSource,
            status: "partial",
            reason: "unparsed_rows",
          })
        }
        if (page.value.truncated) {
          serviceSeeded = false
          errors.push(`datadog:${issueSource}:page_truncated`)
          collection.outcomes.push({
            source: issueSource,
            status: "partial",
            reason: "page_truncated",
          })
        }
        const seen = await dependencies.repository.getSeenIssues(
          page.value.issues.map((issue) => issue.issueId),
        )
        const detection = detectIssueCandidates({
          service,
          window: issueWindow,
          issues: page.value.issues,
          seenIssues: seen,
          alreadySeeded,
          releaseSessionFilter: profile.releaseSessionFilter,
          config: {
            releaseVersionPattern: config.releaseVersionPattern,
            devSessionMarkers: config.devSessionMarkers,
            regressionMultiplier: config.regressionMultiplier,
            minOccurrences: config.minOccurrences,
          },
        })
        collection.candidates.push(...detection.candidates)
        collection.seenUpdates.push(...detection.seenUpdates)
        counters.signalsExcludedDevSession += detection.excludedDevSession
        counters.signalsExcludedMuted += detection.excludedMuted
        counters.signalsExcludedBaselined += detection.baselined
        counters.signalsExcludedForeignService +=
          detection.excludedForeignService
        counters.epochsMinted += detection.epochsMinted
        if (alreadySeeded || !issueReadIncomplete) {
          collection.cursors.push({
            source: issueSource,
            cursorAt: issueWindow.to,
            // A read that parsed nothing is not a live source, whatever the
            // HTTP status said. Stamping success here is what let a renamed
            // Datadog field read as a healthy quiet service forever.
            succeeded:
              page.value.unparsedRows === 0 || page.value.issues.length > 0,
            succeededAt: now,
          })
        } else {
          // Holding the cursor keeps the next run on the WIDE baseline window.
          // Advancing it collapses that window to the overlap, so the service
          // would seed off ~one hour and ticket every standing error as new.
          errors.push(`datadog:${issueSource}:baseline_read_incomplete`)
        }
        if (!issueReadIncomplete) {
          collection.outcomes.push({ source: issueSource, status: "ok" })
        }
      }
    }

    // ── Monitors ─────────────────────────────────────────────────────────
    const monitorSource = cursorSource("monitor", service)
    const monitorWindow = windowFor(monitorSource)
    if (!monitorWindow) {
      collection.outcomes.push({
        source: monitorSource,
        status: "skipped",
        reason: "empty_window",
      })
    } else {
      recordWindow(collection, monitorSource, monitorWindow, errors)
      await heartbeat()
      const monitors = await dependencies.datadog.listMonitors({
        monitorTag: `service:${service}`,
      })
      if (!monitors.ok) {
        serviceSeeded = false
        collection.outcomes.push({
          source: monitorSource,
          status: "failed",
          reason: monitors.reason,
        })
        errors.push(`datadog:${monitorSource}:${monitors.reason}`)
      } else {
        counters.signalsFetched += monitors.value.monitors.length
        if (monitors.value.unparsedRows > 0) {
          // Same rule as the issue source: an incomplete read must not seed,
          // or the rows it dropped arrive next run as brand new.
          serviceSeeded = false
          errors.push(`datadog:${monitorSource}:unparsed_rows`)
          collection.outcomes.push({
            source: monitorSource,
            status: "partial",
            reason: "unparsed_rows",
          })
        }
        const states = await dependencies.repository.getMonitorStates(
          monitors.value.monitors.map((monitor) => monitor.monitorId),
        )
        const detection = detectMonitorSignals({
          service,
          window: monitorWindow,
          monitors: monitors.value.monitors,
          states,
          alreadySeeded,
          now,
          cooldownMs: config.monitorCooldownMs,
        })
        collection.candidates.push(...detection.candidates)
        collection.monitorUpdates.push(...detection.stateUpdates)
        collection.cursors.push({
          source: monitorSource,
          cursorAt: monitorWindow.to,
          // Same rule as the issue source: a read that parsed nothing is not a
          // live source, whatever the HTTP status said, and `last_success_at`
          // is the only liveness signal the runbook has.
          succeeded:
            monitors.value.unparsedRows === 0 ||
            monitors.value.monitors.length > 0,
          succeededAt: now,
        })
        if (monitors.value.unparsedRows === 0) {
          collection.outcomes.push({ source: monitorSource, status: "ok" })
        }
      }
    }

    // ── One bounded spike aggregate (R4) ─────────────────────────────────
    const spikeSource = cursorSource("spike", service)
    const spikeWindow = windowFor(spikeSource)
    if (!spikeWindow) {
      collection.outcomes.push({
        source: spikeSource,
        status: "skipped",
        reason: "empty_window",
      })
    } else {
      recordWindow(collection, spikeSource, spikeWindow, errors)
      await heartbeat()
      const useRum = profile.spikeSource === "rum"
      const aggregate = await (useRum
        ? dependencies.datadog.aggregateRumEvents({
            query: `@type:error service:${service}`,
            from: spikeWindow.from,
            to: spikeWindow.to,
          })
        : dependencies.datadog.aggregateLogs({
            query: `service:${service} status:error`,
            from: spikeWindow.from,
            to: spikeWindow.to,
          }))
      if (!aggregate.ok) {
        serviceSeeded = false
        collection.outcomes.push({
          source: spikeSource,
          status: "failed",
          reason: aggregate.reason,
        })
        errors.push(`datadog:${spikeSource}:${aggregate.reason}`)
      } else if (aggregate.value.partial) {
        serviceSeeded = false
        collection.outcomes.push({
          source: spikeSource,
          status: "partial",
          reason: "aggregate_timeout",
        })
        errors.push(`datadog:${spikeSource}:aggregate_timeout`)
      } else {
        const baselines = await dependencies.repository.getSpikeBaselines([
          service,
        ])
        const detection = detectSpikeSignals({
          service,
          window: spikeWindow,
          aggregate: {
            partial: false,
            buckets: aggregate.value.buckets.map((bucket) => ({
              key: bucket.key === "total" ? SPIKE_CLASS : bucket.key,
              count: bucket.count,
            })),
          },
          baselines,
          alreadySeeded,
          now,
          config: {
            spikeMultiplier: config.spikeMultiplier,
            minOccurrences: config.minOccurrences,
            monitorCooldownMs: config.monitorCooldownMs,
          },
        })
        collection.candidates.push(...detection.candidates)
        collection.spikeUpdates.push(...detection.baselineUpdates)
        collection.cursors.push({
          source: spikeSource,
          cursorAt: spikeWindow.to,
          succeeded: true,
          succeededAt: now,
        })
        collection.outcomes.push({ source: spikeSource, status: "ok" })
      }
    }

    // A service is only marked seeded when EVERY source read cleanly, or its
    // next run would treat the unread source's standing signals as new.
    if (!alreadySeeded && serviceSeeded) {
      collection.seededServices.push(service)
    }
  }

  return collection
}

const executeDatadogTriageStep = createStep({
  id: "execute-datadog-mobile-triage",
  description:
    "Sweep Datadog mobile telemetry for new errors, judge what is worth investigating, and file deduplicated Linear tickets.",
  inputSchema: DatadogMobileTriageInputSchema,
  outputSchema: triageRunReportSchema,
  execute: async ({ inputData, mastra }) => {
    const config = getDatadogTriageConfig()
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: 2,
      allowExitOnIdle: true,
      // The pinned pg client runs no statement_timeout, so a slow-but-not-down
      // Postgres would hang every query — including the lease heartbeat — and
      // the `finally` below would never run, leaking connections per hung run.
      connectionTimeoutMillis: 5_000,
      query_timeout: 20_000,
      statement_timeout: 20_000,
    })
    try {
      return await executeDatadogTriage(inputData, {
        config,
        repository: new PostgresDatadogTriageRepository(pool),
        datadog: new DatadogTriageClient(config),
        linear: new TriageLinearClient(config),
        analyzer: mastra.getAgentById(
          "datadogTriageAgent",
        ) as unknown as TriageAnalyzer,
      })
    } finally {
      await pool.end()
    }
  },
})

export const datadogMobileTriageWorkflow = createWorkflow({
  id: "datadog-mobile-triage",
  description:
    "Hourly delta-gated sweep of mobile Datadog telemetry that files researched, deduplicated Linear tickets.",
  inputSchema: DatadogMobileTriageInputSchema,
  outputSchema: triageRunReportSchema,
  schedule: {
    cron: "0 * * * *",
    timezone: "UTC",
  },
})
  .then(executeDatadogTriageStep)
  .commit()
