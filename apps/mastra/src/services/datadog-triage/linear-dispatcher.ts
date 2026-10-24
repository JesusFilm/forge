import type {
  LinearIssueReference,
  TriageLinearClient,
  TriageLinearFailure,
} from "./linear-client"
import type { DatadogTriageRepository } from "./repository"
import { triageMarker } from "./ticket-draft"

/**
 * Outbox drain (U6, KTD7). Runs at the top of EVERY hourly run regardless of
 * whether the delta was empty (R3), so retries and budget-deferred tickets
 * drain on schedule rather than waiting for a new signal to appear.
 */

export type TriageLinearActionClient = Pick<
  TriageLinearClient,
  "findIssueByMarker" | "createIssue"
>

export type TriageDispatchSummary = {
  created: number
  deduplicated: number
  failed: number
  /** Still queued after this run — the R10 backlog, never a silent drop. */
  deferred: number
  issueUrls: string[]
  errors: string[]
}

const ACTION_CLAIM_MS = 20 * 60_000
const BACKOFF_BASE_MINUTES = 5
const BACKOFF_CEILING_MINUTES = 24 * 60
export const MAX_DISPATCH_ATTEMPTS = 5

/** 5min, 10, 20, 40 … capped at 24h. */
export function nextAttemptAt(now: Date, attempts: number): Date {
  const minutes = Math.min(
    BACKOFF_CEILING_MINUTES,
    BACKOFF_BASE_MINUTES * 2 ** Math.max(0, attempts - 1),
  )
  return new Date(now.getTime() + minutes * 60_000)
}

export function shouldTerminate(
  failure: TriageLinearFailure,
  attempts: number,
): boolean {
  return (
    attempts >= MAX_DISPATCH_ATTEMPTS ||
    (!failure.retryable && !failure.ambiguous)
  )
}

export function utcDayStart(at: Date): Date {
  return new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

export async function dispatchDueTriageActions(input: {
  repository: DatadogTriageRepository
  client: TriageLinearActionClient
  maxTicketsPerDay: number
  now: Date
  token: string
  clock?: () => Date
  heartbeat?: () => Promise<void>
}): Promise<TriageDispatchSummary> {
  const summary: TriageDispatchSummary = {
    created: 0,
    deduplicated: 0,
    failed: 0,
    deferred: 0,
    issueUrls: [],
    errors: [],
  }

  for (let processed = 0; processed < input.maxTicketsPerDay; processed += 1) {
    const claimTime = input.clock?.() ?? new Date()
    const [action] = await input.repository.claimDueActions({
      dailyLimit: input.maxTicketsPerDay,
      claimLimit: 1,
      dayStart: utcDayStart(claimTime),
      token: input.token,
      expiresAt: new Date(claimTime.getTime() + ACTION_CLAIM_MS),
      now: claimTime,
    })
    if (!action) break
    await input.heartbeat?.()

    // Always search before creating. On a retry of an ambiguous create this is
    // what finds the issue Linear already accepted and stops a duplicate.
    const existing = await input.client.findIssueByMarker(
      triageMarker(action.idempotencyKey),
    )
    if (!existing.ok) {
      await recordFailure(input, claimTime, action, existing)
      summary.failed += 1
      summary.errors.push(existing.reason)
      continue
    }
    if (existing.value) {
      await markDeduplicated(input, action.idempotencyKey, existing.value)
      summary.deduplicated += 1
      summary.issueUrls.push(existing.value.url)
      continue
    }

    await input.repository.markActionMutationAttempted({
      idempotencyKey: action.idempotencyKey,
      token: input.token,
    })
    const created = await input.client.createIssue(action.draft)
    if (!created.ok) {
      await recordFailure(input, claimTime, action, created)
      summary.failed += 1
      summary.errors.push(created.reason)
      continue
    }
    await input.repository.markActionCreated({
      idempotencyKey: action.idempotencyKey,
      token: input.token,
      issueId: created.value.id,
      issueUrl: created.value.url,
    })
    summary.created += 1
    summary.issueUrls.push(created.value.url)
  }

  summary.deferred = await input.repository.countDueActions(input.now)
  return summary
}

async function markDeduplicated(
  input: { repository: DatadogTriageRepository; token: string },
  idempotencyKey: string,
  issue: LinearIssueReference,
): Promise<void> {
  await input.repository.markActionDeduplicated({
    idempotencyKey,
    token: input.token,
    issueId: issue.id,
    issueUrl: issue.url,
  })
}

async function recordFailure(
  input: { repository: DatadogTriageRepository; token: string },
  now: Date,
  action: { idempotencyKey: string; attempts: number },
  failure: TriageLinearFailure,
): Promise<void> {
  await input.repository.markActionRetryable({
    idempotencyKey: action.idempotencyKey,
    token: input.token,
    errorCode: failure.reason,
    nextAttemptAt: nextAttemptAt(now, action.attempts),
    terminal: shouldTerminate(failure, action.attempts),
  })
}
