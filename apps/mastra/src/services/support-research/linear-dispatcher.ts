import type { SupportResearchConfig } from "../../config/env"
import type {
  LinearClient,
  LinearFailure,
  LinearIssueReference,
} from "./linear-client"
import type { SupportResearchRepository } from "./repository"
import type { SupportActionType } from "./schema"

export type LinearActionClient = Pick<
  LinearClient,
  "findIssueByMarker" | "createIssue"
>

export type LinearDispatchSummary = {
  created: number
  deduplicated: number
  failed: number
  deferred: number
  issueUrls: string[]
  errors: string[]
}

const ACTION_CLAIM_MS = 20 * 60_000

function marker(idempotencyKey: string): string {
  return `<!-- support-research-key:${idempotencyKey} -->`
}

function nextAttempt(now: Date, attempts: number): Date {
  const minutes = Math.min(24 * 60, 5 * 2 ** Math.max(0, attempts - 1))
  return new Date(now.getTime() + minutes * 60_000)
}

function shouldTerminate(failure: LinearFailure, attempts: number): boolean {
  return attempts >= 5 || (!failure.retryable && !failure.ambiguous)
}

export async function dispatchDueSupportActions(input: {
  repository: SupportResearchRepository
  client: LinearActionClient
  config: Pick<SupportResearchConfig, "maxActionsPerRun">
  actionTypes: SupportActionType[]
  createdSince: Date
  now: Date
  token: string
  clock?: () => Date
  heartbeat?: () => Promise<void>
}): Promise<LinearDispatchSummary> {
  const summary: LinearDispatchSummary = {
    created: 0,
    deduplicated: 0,
    failed: 0,
    deferred: 0,
    issueUrls: [],
    errors: [],
  }

  for (
    let processed = 0;
    processed < input.config.maxActionsPerRun;
    processed += 1
  ) {
    const claimTime = input.clock?.() ?? new Date()
    const [action] = await input.repository.claimDueActions({
      dailyLimit: input.config.maxActionsPerRun,
      claimLimit: 1,
      actionTypes: input.actionTypes,
      createdSince: input.createdSince,
      token: input.token,
      expiresAt: new Date(claimTime.getTime() + ACTION_CLAIM_MS),
      now: claimTime,
    })
    if (!action) break
    await input.heartbeat?.()
    const existing = await input.client.findIssueByMarker(
      marker(action.idempotencyKey),
    )
    if (!existing.ok) {
      await recordFailure(
        {
          repository: input.repository,
          now: claimTime,
          token: input.token,
        },
        action,
        existing,
      )
      summary.failed += 1
      summary.errors.push(existing.reason)
      continue
    }
    if (existing.value) {
      await input.repository.markActionDeduplicated({
        idempotencyKey: action.idempotencyKey,
        token: input.token,
        issueId: existing.value.id,
        issueUrl: existing.value.url,
      })
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
      await recordFailure(
        {
          repository: input.repository,
          now: claimTime,
          token: input.token,
        },
        action,
        created,
      )
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

  summary.deferred = await input.repository.countDueActions({
    actionTypes: input.actionTypes,
    now: input.now,
  })

  return summary
}

async function recordFailure(
  input: {
    repository: SupportResearchRepository
    now: Date
    token: string
  },
  action: { idempotencyKey: string; attempts: number },
  failure: LinearFailure,
): Promise<void> {
  await input.repository.markActionRetryable({
    idempotencyKey: action.idempotencyKey,
    token: input.token,
    errorCode: failure.reason,
    nextAttemptAt: nextAttempt(input.now, action.attempts),
    terminal: shouldTerminate(failure, action.attempts),
  })
}

export type { LinearIssueReference }
