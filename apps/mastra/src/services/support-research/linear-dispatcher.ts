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
}): Promise<LinearDispatchSummary> {
  const actions = await input.repository.claimDueActions({
    limit: input.config.maxActionsPerRun,
    actionTypes: input.actionTypes,
    createdSince: input.createdSince,
    token: input.token,
    expiresAt: new Date(input.now.getTime() + 10 * 60_000),
    now: input.now,
  })
  const summary: LinearDispatchSummary = {
    created: 0,
    deduplicated: 0,
    failed: 0,
    deferred: 0,
    issueUrls: [],
    errors: [],
  }

  for (const action of actions) {
    const existing = await input.client.findIssueByMarker(
      marker(action.idempotencyKey),
    )
    if (!existing.ok) {
      await recordFailure(input, action, existing)
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

    const created = await input.client.createIssue(action.draft)
    if (!created.ok) {
      await recordFailure(input, action, created)
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
