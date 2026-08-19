import { z } from "zod"

import { isLinearGraphqlUrl, type DatadogTriageConfig } from "../../config/env"
import { discardResponseBody } from "../devotional/bounded-response"

import {
  BOUNDED_READ_OVER_CAP,
  isAbortLike,
  readJsonBodyCappedOrThrow,
} from "./bounded-read"

import type { TriageActionDraft } from "./schema"

/**
 * Linear client for the triage outbox (U6), scoped to its OWN credentials and
 * project (R16) so it shares nothing with the support-research or SEO
 * integrations. Copied from `support-research/linear-client.ts`, which is the
 * proven shape in this runtime.
 */

const issueSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  description: z.string().nullish(),
  project: z.object({ id: z.string().nullish() }).nullish(),
})

const duplicateQuerySchema = z.object({
  data: z
    .object({
      team: z
        .object({
          issues: z.object({
            nodes: z.array(issueSchema),
            pageInfo: z
              .object({
                hasNextPage: z.boolean(),
                endCursor: z.string().nullable(),
              })
              .optional(),
          }),
        })
        .nullable(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        extensions: z
          .object({ code: z.string().optional() })
          .passthrough()
          .optional(),
      }),
    )
    .optional(),
})
type DuplicateQueryResponse = z.infer<typeof duplicateQuerySchema>
type DuplicateIssueConnection = NonNullable<
  NonNullable<DuplicateQueryResponse["data"]>["team"]
>["issues"]

const createIssueSchema = z.object({
  data: z
    .object({
      issueCreate: z.object({
        success: z.boolean(),
        issue: issueSchema.nullable(),
      }),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        extensions: z
          .object({ code: z.string().optional() })
          .passthrough()
          .optional(),
      }),
    )
    .optional(),
})

export type LinearIssueReference = { id: string; url: string }

export type TriageLinearFailureReason =
  | "config_missing"
  | "invalid_config"
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "rejected"
  | "parse_error"
  | "response_too_large"
  | "graphql_error"

export type TriageLinearFailure = {
  ok: false
  reason: TriageLinearFailureReason
  retryable: boolean
  /** True when a MUTATION may have landed despite the failure. */
  ambiguous: boolean
  status?: number
}

export type TriageLinearResult<T> = { ok: true; value: T } | TriageLinearFailure

type TriageLinearConfig = Pick<
  DatadogTriageConfig,
  "timeoutMs" | "maxResponseBytes"
> & { linear: DatadogTriageConfig["linear"] }

/**
 * 5 pages of 50 is enough because of what the search is FOR: reconciling an
 * AMBIGUOUS create, whose issue was made minutes ago and sits at the top of
 * the list. Long-term dedup is the outbox primary key's job, not this query's.
 */
const MARKER_SEARCH_PAGES = 5

function endpoint(value: string): URL | undefined {
  if (!isLinearGraphqlUrl(value)) return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function failureForStatus(status: number): TriageLinearFailure {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      ambiguous: false,
      status,
    }
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      retryable: true,
      ambiguous: false,
      status,
    }
  }
  return {
    ok: false,
    reason: status >= 500 ? "network_error" : "rejected",
    retryable: status >= 500,
    ambiguous: false,
    status,
  }
}

function fetchFailure(error: unknown, mutation: boolean): TriageLinearFailure {
  const name = (error as { name?: string } | undefined)?.name
  return {
    ok: false,
    reason:
      name === "TimeoutError" || name === "AbortError"
        ? "timeout"
        : "network_error",
    retryable: true,
    // A lost response to a create may still have created the issue.
    ambiguous: mutation,
  }
}

function graphqlFailure(
  errors: Array<{ extensions?: { code?: string } }>,
): TriageLinearFailure {
  const rateLimited = errors.some(
    (error) => error.extensions?.code === "RATELIMITED",
  )
  return {
    ok: false,
    reason: rateLimited ? "rate_limited" : "graphql_error",
    retryable: rateLimited,
    ambiguous: false,
  }
}

export class TriageLinearClient {
  private readonly apiUrl: URL | undefined

  constructor(
    private readonly config: TriageLinearConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl = endpoint(config.linear.apiUrl)
  }

  async findIssueByMarker(
    marker: string,
  ): Promise<TriageLinearResult<LinearIssueReference | undefined>> {
    // Both ids are required: the project is what scopes the match, so without
    // it this would read wider than the pipeline writes.
    if (!this.config.linear.teamId || !this.config.linear.projectId) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        ambiguous: false,
      }
    }
    let after: string | null = null
    for (let page = 0; page < MARKER_SEARCH_PAGES; page += 1) {
      const result: TriageLinearResult<DuplicateQueryResponse> =
        await this.graphql(
          `query DatadogTriageFindDuplicate($teamId: String!, $after: String) {
        team(id: $teamId) {
          issues(first: 50, after: $after) {
            nodes { id url description project { id } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
          { teamId: this.config.linear.teamId, after },
          duplicateQuerySchema,
          false,
        )
      if (!result.ok) return result
      if (result.value.errors?.length) {
        return graphqlFailure(result.value.errors)
      }
      const connection: DuplicateIssueConnection | undefined =
        result.value.data?.team?.issues
      // Match only inside the project this pipeline writes to. The marker is
      // an HTML comment in every filed ticket, so it rides along whenever a
      // human copies a triage ticket's body — and a false match here reports
      // an unrelated issue as the ticket and hides the real regression.
      const issue = connection?.nodes.find(
        (item: z.infer<typeof issueSchema>) =>
          item.description?.includes(marker) &&
          item.project?.id === this.config.linear.projectId,
      )
      if (issue) {
        return { ok: true, value: { id: issue.id, url: issue.url } }
      }
      if (
        !connection?.pageInfo?.hasNextPage ||
        !connection.pageInfo.endCursor
      ) {
        break
      }
      after = connection.pageInfo.endCursor
    }
    return { ok: true, value: undefined }
  }

  /**
   * Create the issue. The payload deliberately carries no `priority` and no
   * `assigneeId` (R9) — those stay a human decision, so this integration has
   * no field through which it could set them.
   */
  async createIssue(
    draft: TriageActionDraft,
  ): Promise<TriageLinearResult<LinearIssueReference>> {
    const { teamId, projectId } = this.config.linear
    if (!teamId || !projectId) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        ambiguous: false,
      }
    }
    const result = await this.graphql(
      `mutation DatadogTriageCreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id url description }
        }
      }`,
      {
        input: {
          teamId,
          projectId,
          title: draft.title,
          description: draft.description,
          ...(draft.labelId ? { labelIds: [draft.labelId] } : {}),
        },
      },
      createIssueSchema,
      true,
    )
    if (!result.ok) return result
    if (result.value.errors?.length) {
      return graphqlFailure(result.value.errors)
    }
    const created = result.value.data?.issueCreate
    if (!created?.success || !created.issue) {
      return {
        ok: false,
        reason: "graphql_error",
        retryable: false,
        ambiguous: false,
      }
    }
    return { ok: true, value: { id: created.issue.id, url: created.issue.url } }
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    mutation: boolean,
  ): Promise<TriageLinearResult<T>> {
    if (!this.apiUrl) {
      return {
        ok: false,
        reason: "invalid_config",
        retryable: false,
        ambiguous: false,
      }
    }
    if (!this.config.linear.apiKey) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        ambiguous: false,
      }
    }

    let response: Response
    try {
      response = await this.fetchImpl(this.apiUrl, {
        method: "POST",
        headers: {
          authorization: this.config.linear.apiKey,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "forge-mastra-datadog-triage/1.0",
        },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      return fetchFailure(error, mutation)
    }
    if (!response.ok) {
      await discardResponseBody(response)
      return failureForStatus(response.status)
    }
    // Uses the rethrowing reader, not the shared swallowing one: a mid-body
    // timeout classified as non-retryable `parse_error` would terminalize the
    // outbox row on attempt ONE and silently drop a signal R10 keeps.
    let body: unknown
    try {
      body = await readJsonBodyCappedOrThrow(
        response,
        this.config.maxResponseBytes,
      )
    } catch (error) {
      return {
        ok: false,
        reason: isAbortLike(error) ? "timeout" : "network_error",
        retryable: true,
        ambiguous: mutation,
      }
    }
    if (body === BOUNDED_READ_OVER_CAP) {
      // Same harm as the timeout above, reached through the byte cap: an
      // over-cap body says nothing about whether Linear accepted the call, so
      // terminalizing on it would drop a signal over a paging problem that a
      // later attempt can clear.
      return {
        ok: false,
        reason: "response_too_large",
        retryable: true,
        ambiguous: mutation,
      }
    }
    const parsed = schema.safeParse(body)
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          reason: "parse_error",
          retryable: false,
          ambiguous: mutation,
        }
  }
}
