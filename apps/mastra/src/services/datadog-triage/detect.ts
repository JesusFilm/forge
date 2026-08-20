import type {
  DatadogAggregate,
  DatadogIssue,
  DatadogMonitor,
} from "./datadog-client"
import type {
  MonitorState,
  MonitorStateUpdate,
  SeenIssue,
  SeenIssueUpdate,
  SpikeBaseline,
  SpikeBaselineUpdate,
  TriageSignalKind,
} from "./schema"

/**
 * Pure detection (U4). Everything here is a function of its inputs — no I/O,
 * no clock, no env read — so every acceptance example can be driven by a
 * fixture and every gate can be falsified on its own.
 */

/**
 * Standing upper bound on a single fetch window. After a long outage the
 * cursor can sit days back; asking for all of it at once would blow the page
 * limit and return a truncated view that looks complete. Clamping and SAYING
 * SO (`clamped`) keeps the run honest — the cursor still advances only as far
 * as it actually read, so the backlog drains an hour at a time.
 *
 * The caller's `fallbackLookbackMs` overrides this when it is wider, because
 * that value is a DELIBERATE wide read: it is what a service's first covered
 * run uses to record its standing issue set (F3). Clamping that to 24h would
 * baseline only the last day and make every older standing error look new on
 * the second run — the exact outcome AE5 exists to prevent.
 */
export const MAX_WINDOW_MS = 24 * 60 * 60_000

/** Datadog issue states an operator uses as the mute lever (R18). */
export const MUTED_ISSUE_STATES = new Set(["IGNORED", "EXCLUDED"])

/** Hours of observation before a spike baseline is trusted enough to fire. */
export const MIN_SPIKE_OBSERVATIONS = 3

export type DetectionWindow = {
  from: Date
  to: Date
  /** True when MAX_WINDOW_MS trimmed the requested start. */
  clamped: boolean
}

export type TriageIssueEvidence = {
  kind: "issue"
  issueId: string
  errorType?: string
  errorMessage?: string
  filePath?: string
  functionName?: string
  platform?: string
  isCrash?: boolean
  firstSeen?: string
  lastSeen?: string
  lastSeenVersion?: string
  windowCount: number
  windowRatePerHour: number
  baselineRatePerHour: number
  regression: boolean
}

export type TriageMonitorEvidence = {
  kind: "monitor"
  monitorId: string
  name?: string
  overallState?: string
  episodeStartedAt?: string
}

export type TriageSpikeEvidence = {
  kind: "spike"
  spikeClass: string
  windowCount: number
  windowRatePerHour: number
  baselineRatePerHour: number
}

export type TriageEvidence =
  | TriageIssueEvidence
  | TriageMonitorEvidence
  | TriageSpikeEvidence

export type TriageCandidate = {
  service: string
  signalKind: TriageSignalKind
  signalId: string
  epoch: number
  /** Deterministic ordering key and the point the cursor holds at if capped. */
  occurredAt: string
  windowStart: string
  windowEnd: string
  evidence: TriageEvidence
}

export type IssueDetection = {
  candidates: TriageCandidate[]
  seenUpdates: SeenIssueUpdate[]
  excludedDevSession: number
  excludedMuted: number
  excludedForeignService: number
  baselined: number
  epochsMinted: number
}

export type MonitorDetection = {
  candidates: TriageCandidate[]
  stateUpdates: MonitorStateUpdate[]
}

export type SpikeDetection = {
  candidates: TriageCandidate[]
  baselineUpdates: SpikeBaselineUpdate[]
}

export type ReleaseFilterConfig = {
  releaseVersionPattern: string
  devSessionMarkers: string[]
}

export type IssueDetectionConfig = ReleaseFilterConfig & {
  regressionMultiplier: number
  minOccurrences: number
}

export type SpikeDetectionConfig = {
  spikeMultiplier: number
  minOccurrences: number
  monitorCooldownMs: number
}

/**
 * Resolve one source's absolute fetch window (KTD2). Datadog offers no
 * "changed since", so every read is an absolute `[from, to]` and the client
 * diffs the result against stored state.
 *
 * `to` trails `now` by the ingestion lag so the tail of the window is not read
 * before Datadog has finished indexing it. `from` reaches back past the cursor
 * by the overlap so an event that landed late is still seen; the overlap
 * re-read is deduplicated by signal id, not by time.
 */
export function resolveSourceWindow(input: {
  cursorAt?: string
  now: Date
  overlapMs: number
  lagMs: number
  fallbackLookbackMs: number
}): DetectionWindow | undefined {
  const to = new Date(input.now.getTime() - input.lagMs)
  const cursorMs = input.cursorAt ? Date.parse(input.cursorAt) : Number.NaN
  const requestedFrom = Number.isNaN(cursorMs)
    ? to.getTime() - input.fallbackLookbackMs
    : cursorMs - input.overlapMs
  const earliest =
    to.getTime() - Math.max(MAX_WINDOW_MS, input.fallbackLookbackMs)
  const fromMs = Math.max(requestedFrom, earliest)
  if (to.getTime() <= fromMs) return undefined
  return {
    from: new Date(fromMs),
    to,
    clamped: requestedFrom < earliest,
  }
}

function windowHours(window: DetectionWindow): number {
  return Math.max(
    (window.to.getTime() - window.from.getTime()) / 3_600_000,
    1 / 60,
  )
}

/**
 * The recurrence gate expressed in the unit every baseline comparison uses.
 * `minOccurrences` is a per-window COUNT; this reads it as "that many inside
 * one hour", which is the floor below which a rate cannot justify a ticket.
 */
function minOccurrencesPerHour(minOccurrences: number): number {
  return minOccurrences
}

function ratePerHour(count: number, window: DetectionWindow): number {
  return count / windowHours(window)
}

function compileReleasePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "u")
  } catch {
    return undefined
  }
}

/**
 * R17/KTD4 at issue granularity, failing OPEN toward coverage: an issue is
 * dev-shaped only when nothing about its windowed activity looks like a
 * release session. Any release-shaped version keeps the issue in, which is why
 * an issue whose activity spans both a dev session and a real build survives.
 *
 * The version discriminator is primary. It is the one that separated every
 * issue in the live 2026-08-19 `forge-mobile` sample: real builds carry
 * semver, the noise carried ad-hoc tags. The message/path markers are a
 * secondary signal for an issue that carries no version at all.
 */
export function isDevShapedIssue(
  issue: Pick<
    DatadogIssue,
    "firstSeenVersion" | "lastSeenVersion" | "errorMessage" | "filePath"
  >,
  config: ReleaseFilterConfig,
): boolean {
  const pattern = compileReleasePattern(config.releaseVersionPattern)
  const versions = [issue.firstSeenVersion, issue.lastSeenVersion].filter(
    (version): version is string => typeof version === "string",
  )
  // An unusable pattern must not silently exclude everything.
  if (pattern && versions.some((version) => pattern.test(version))) return false

  const haystack =
    `${issue.errorMessage ?? ""}\n${issue.filePath ?? ""}`.toLowerCase()
  const markerHit = config.devSessionMarkers.some(
    (marker) => marker.length > 0 && haystack.includes(marker),
  )
  const versionsAllDevShaped =
    pattern !== undefined &&
    versions.length > 0 &&
    !versions.some((version) => pattern.test(version))

  return versionsAllDevShaped || markerHit
}

export function isMutedIssue(issue: Pick<DatadogIssue, "state">): boolean {
  return issue.state !== undefined && MUTED_ISSUE_STATES.has(issue.state)
}

/**
 * Turn one service's issue page into candidates and state updates.
 *
 * On a service's very first covered run (`alreadySeeded === false`) this
 * records the standing issue set as the baseline and emits ZERO candidates
 * (F3/AE5) — otherwise enabling the flag would file a ticket for every error
 * that has ever happened.
 */
export function detectIssueCandidates(input: {
  service: string
  window: DetectionWindow
  issues: DatadogIssue[]
  seenIssues: SeenIssue[]
  alreadySeeded: boolean
  releaseSessionFilter: boolean
  config: IssueDetectionConfig
}): IssueDetection {
  const seenById = new Map(
    input.seenIssues.map((seen) => [seen.issueId, seen] as const),
  )
  const detection: IssueDetection = {
    candidates: [],
    seenUpdates: [],
    excludedDevSession: 0,
    excludedMuted: 0,
    excludedForeignService: 0,
    baselined: 0,
    epochsMinted: 0,
  }

  const handled = new Set<string>()
  for (const issue of input.issues) {
    // The overlap re-read can return the same issue twice across pages.
    if (handled.has(issue.issueId)) continue
    handled.add(issue.issueId)

    // AE6: the query is service-scoped, but never ticket a service the
    // operator did not put on the coverage list.
    if (issue.service !== undefined && issue.service !== input.service) {
      detection.excludedForeignService += 1
      continue
    }
    // R18: a muted issue is skipped whole — no candidate and no state write,
    // so unmuting later behaves like a fresh signal.
    if (isMutedIssue(issue)) {
      detection.excludedMuted += 1
      continue
    }
    if (input.releaseSessionFilter && isDevShapedIssue(issue, input.config)) {
      detection.excludedDevSession += 1
      continue
    }

    const windowRate = ratePerHour(issue.totalCount, input.window)
    const lastActivityAt = issue.lastSeen ?? input.window.to.toISOString()
    const firstSeenAt = issue.firstSeen ?? lastActivityAt
    const seen = seenById.get(issue.issueId)

    if (!input.alreadySeeded) {
      detection.seenUpdates.push({
        issueId: issue.issueId,
        service: input.service,
        epoch: seen?.epoch ?? 0,
        // The seed window spans days while every later comparison spans an
        // hour, so a raw average would read far below any active hour and make
        // ordinary activity look like a regression on the very next run.
        // Floor it at the recurrence gate read as an HOURLY rate — the units
        // differ, which is the point: `minOccurrences` occurrences inside one
        // hour is the least activity this pipeline ever acts on, so no
        // baseline below it can make the multiplier mean anything. Raising
        // `DATADOG_TRIAGE_MIN_OCCURRENCES` therefore also raises the seeded
        // regression bar to `minOccurrences × regressionMultiplier` per hour.
        // The `!seen` branch below needs no floor: a candidate has already
        // cleared the same gate in a one-hour window.
        baselineRate: Math.max(
          windowRate,
          minOccurrencesPerHour(input.config.minOccurrences),
        ),
        lastActivityAt,
        firstSeenAt,
      })
      continue
    }

    if (!seen) {
      detection.candidates.push(
        issueCandidate({
          service: input.service,
          window: input.window,
          issue,
          epoch: 0,
          baselineRate: 0,
          windowRate,
          regression: false,
          occurredAt: lastActivityAt,
          firstSeenAt,
        }),
      )
      // Every candidate carries its state update, exactly as the monitor and
      // spike detectors do. Without this the issue is never baselined: it comes
      // back as new every hour, burns a judgment each time, and can never reach
      // the regression branch below, which needs a stored epoch to increment.
      detection.seenUpdates.push({
        issueId: issue.issueId,
        service: input.service,
        epoch: 0,
        baselineRate: windowRate,
        lastActivityAt,
        firstSeenAt,
      })
      continue
    }

    // R14/KTD6: a baselined issue only speaks again when its activity clears
    // the regression multiplier AND the absolute floor. The floor is what
    // stops a baseline of 0.1/h from making two occurrences a "regression".
    const regressed =
      issue.totalCount >= input.config.minOccurrences &&
      windowRate > seen.baselineRate * input.config.regressionMultiplier
    if (!regressed) {
      detection.baselined += 1
      detection.seenUpdates.push({
        issueId: issue.issueId,
        service: input.service,
        epoch: seen.epoch,
        baselineRate: seen.baselineRate,
        lastActivityAt,
        firstSeenAt: seen.firstSeenAt,
      })
      continue
    }

    detection.epochsMinted += 1
    detection.candidates.push(
      issueCandidate({
        service: input.service,
        window: input.window,
        issue,
        epoch: seen.epoch + 1,
        baselineRate: seen.baselineRate,
        windowRate,
        regression: true,
        occurredAt: lastActivityAt,
        firstSeenAt: seen.firstSeenAt,
      }),
    )
    // The regressed rate becomes the new baseline, so the elevated issue does
    // not re-fire every hour once its epoch is minted.
    detection.seenUpdates.push({
      issueId: issue.issueId,
      service: input.service,
      epoch: seen.epoch + 1,
      baselineRate: windowRate,
      lastActivityAt,
      firstSeenAt: seen.firstSeenAt,
    })
  }

  return detection
}

function issueCandidate(input: {
  service: string
  window: DetectionWindow
  issue: DatadogIssue
  epoch: number
  baselineRate: number
  windowRate: number
  regression: boolean
  occurredAt: string
  firstSeenAt: string
}): TriageCandidate {
  return {
    service: input.service,
    signalKind: "issue",
    signalId: input.issue.issueId,
    epoch: input.epoch,
    occurredAt: input.occurredAt,
    windowStart: input.window.from.toISOString(),
    windowEnd: input.window.to.toISOString(),
    evidence: {
      kind: "issue",
      issueId: input.issue.issueId,
      errorType: input.issue.errorType,
      errorMessage: input.issue.errorMessage,
      filePath: input.issue.filePath,
      functionName: input.issue.functionName,
      platform: input.issue.platform,
      isCrash: input.issue.isCrash,
      firstSeen: input.issue.firstSeen,
      lastSeen: input.issue.lastSeen,
      lastSeenVersion: input.issue.lastSeenVersion,
      windowCount: input.issue.totalCount,
      windowRatePerHour: input.windowRate,
      baselineRatePerHour: input.baselineRate,
      regression: input.regression,
    },
  }
}

/**
 * Monitor episodes (KTD6). One signal per alert episode, identified by the
 * state-change timestamp, with a per-monitor cooldown so a flapping monitor
 * cannot spend the whole daily budget by itself.
 */
export function detectMonitorSignals(input: {
  service: string
  window: DetectionWindow
  monitors: DatadogMonitor[]
  states: MonitorState[]
  alreadySeeded: boolean
  now: Date
  cooldownMs: number
}): MonitorDetection {
  const stateById = new Map(
    input.states.map((state) => [state.monitorId, state] as const),
  )
  const detection: MonitorDetection = {
    candidates: [],
    stateUpdates: [],
  }

  for (const monitor of input.monitors) {
    const stored = stateById.get(monitor.monitorId)
    const episodeStartedAt = monitor.overallStateModified ?? null
    const alerting = monitor.overallState === "Alert"

    const baseUpdate: MonitorStateUpdate = {
      monitorId: monitor.monitorId,
      service: input.service,
      overallState: monitor.overallState ?? "Unknown",
      lastEpisodeStartedAt: episodeStartedAt,
      lastTicketedAt: stored?.lastTicketedAt ?? null,
    }

    const newEpisode =
      alerting &&
      episodeStartedAt !== null &&
      stored?.lastEpisodeStartedAt !== episodeStartedAt
    const withinCooldown =
      stored?.lastTicketedAt !== undefined &&
      stored?.lastTicketedAt !== null &&
      input.now.getTime() - Date.parse(stored.lastTicketedAt) < input.cooldownMs

    if (!input.alreadySeeded || !newEpisode || withinCooldown) {
      detection.stateUpdates.push(baseUpdate)
      continue
    }

    detection.candidates.push({
      service: input.service,
      signalKind: "monitor",
      signalId: `${monitor.monitorId}:${episodeStartedAt}`,
      epoch: 0,
      occurredAt: episodeStartedAt,
      windowStart: input.window.from.toISOString(),
      windowEnd: input.window.to.toISOString(),
      evidence: {
        kind: "monitor",
        monitorId: monitor.monitorId,
        name: monitor.name,
        overallState: monitor.overallState,
        episodeStartedAt,
      },
    })
    // No `lastTicketedAt` here. Detection does not know whether a ticket will
    // actually be filed, and stamping the cooldown for a candidate the policy
    // later suppresses would blackout the monitor over a ticket that never
    // existed. The workflow stamps it once the outcome is known.
    detection.stateUpdates.push(baseUpdate)
  }

  return detection
}

/**
 * Bounded spike check against a trailing baseline (KTD6). A partial aggregate
 * — the 200-with-`meta.status: "timeout"` case — must never reach here: its
 * numbers are an undercount, so folding them into a baseline would depress the
 * baseline and cause false spikes later.
 */
export function detectSpikeSignals(input: {
  service: string
  window: DetectionWindow
  aggregate: DatadogAggregate
  baselines: SpikeBaseline[]
  alreadySeeded: boolean
  now: Date
  config: SpikeDetectionConfig
}): SpikeDetection {
  const detection: SpikeDetection = {
    candidates: [],
    baselineUpdates: [],
  }
  if (input.aggregate.partial) {
    return detection
  }

  const baselineByClass = new Map(
    input.baselines.map((baseline) => [baseline.spikeClass, baseline] as const),
  )

  for (const bucket of input.aggregate.buckets) {
    const stored = baselineByClass.get(bucket.key)
    const windowRate = ratePerHour(bucket.count, input.window)
    const observations = stored?.observations ?? 0
    // Running mean, so one loud hour cannot redefine normal on its own.
    const blended =
      observations === 0
        ? windowRate
        : (stored!.baselineRate * observations + windowRate) /
          (observations + 1)
    const epoch = stored?.epoch ?? 0
    const nextBaseline: SpikeBaselineUpdate = {
      service: input.service,
      spikeClass: bucket.key,
      baselineRate: blended,
      observations: Math.min(observations + 1, 168),
      epoch,
      lastTicketedAt: stored?.lastTicketedAt ?? null,
    }

    const withinCooldown =
      stored?.lastTicketedAt != null &&
      input.now.getTime() - Date.parse(stored.lastTicketedAt) <
        input.config.monitorCooldownMs
    const spiked =
      input.alreadySeeded &&
      observations >= MIN_SPIKE_OBSERVATIONS &&
      bucket.count >= input.config.minOccurrences &&
      windowRate > (stored?.baselineRate ?? 0) * input.config.spikeMultiplier

    if (!spiked || withinCooldown) {
      detection.baselineUpdates.push(nextBaseline)
      continue
    }

    // A ticketed episode advances the epoch, so the NEXT one gets a new key.
    // Withheld candidates have this update filtered out at commit, so a
    // re-read keeps the same key instead of minting a duplicate.
    detection.baselineUpdates.push({ ...nextBaseline, epoch: epoch + 1 })
    detection.candidates.push({
      service: input.service,
      signalKind: "spike",
      signalId: `${input.service}:${bucket.key}`,
      epoch,
      // Anchored at the window START, not its end. `holdCursor` pins a
      // withheld candidate's source at this instant, and the end is exactly
      // where the cursor would advance to anyway — so anchoring there made a
      // withheld spike silently unrecoverable instead of re-read next run.
      occurredAt: input.window.from.toISOString(),
      windowStart: input.window.from.toISOString(),
      windowEnd: input.window.to.toISOString(),
      evidence: {
        kind: "spike",
        spikeClass: bucket.key,
        windowCount: bucket.count,
        windowRatePerHour: windowRate,
        baselineRatePerHour: stored?.baselineRate ?? 0,
      },
    })
    // Cooldown stamping belongs to the workflow, which knows the outcome; the
    // epoch-advanced update was pushed above, before the candidate.
  }

  return detection
}

export type CandidateCapResult = {
  judged: TriageCandidate[]
  deferred: TriageCandidate[]
  /**
   * The point this source's cursor may advance to. When the cap bites it is
   * the earliest DEFERRED candidate's timestamp, so the next window re-reads
   * everything that was not judged (KTD2).
   */
  cursorAt: string
}

/**
 * Deterministic order, then the per-run cap. Oldest first: it is what makes
 * "hold the cursor at the earliest unjudged point" a correct statement — with
 * newest-first the held cursor would re-read work already done.
 */
export function applyCandidateCap(
  candidates: TriageCandidate[],
  cap: number,
  windowEnd: Date,
): CandidateCapResult {
  const ordered = [...candidates].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt < right.occurredAt ? -1 : 1
    }
    return left.signalId < right.signalId ? -1 : 1
  })
  const judged = ordered.slice(0, Math.max(0, cap))
  const deferred = ordered.slice(Math.max(0, cap))
  return {
    judged,
    deferred,
    cursorAt: deferred[0]?.occurredAt ?? windowEnd.toISOString(),
  }
}
