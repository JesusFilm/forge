import { z } from "zod"

import type { SupportResearchConfig } from "../../config/env"
import {
  discardResponseBody,
  readResponseJsonCapped,
} from "../devotional/bounded-response"
import type { SupportActionDraft } from "./schema"

const issueSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  description: z.string().nullish(),
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

export type LinearFailureReason =
  | "config_missing"
  | "invalid_config"
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "rejected"
  | "parse_error"
  | "graphql_error"

export type LinearFailure = {
  ok: false
  reason: LinearFailureReason
  retryable: boolean
  ambiguous: boolean
  status?: number
}

export type LinearResult<T> = { ok: true; value: T } | LinearFailure

type LinearConfig = Pick<
  SupportResearchConfig,
  "timeoutMs" | "maxResponseBytes"
> & { linear: SupportResearchConfig["linear"] }

function endpoint(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.linear.app" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/graphql" ||
      url.search ||
      url.hash
    ) {
      return
    }
    return url
  } catch {
    return
  }
}

function failureForStatus(status: number): LinearFailure {
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

function fetchFailure(error: unknown, mutation: boolean): LinearFailure {
  const name = (error as { name?: string } | undefined)?.name
  return {
    ok: false,
    reason:
      name === "TimeoutError" || name === "AbortError"
        ? "timeout"
        : "network_error",
    retryable: true,
    ambiguous: mutation,
  }
}

function graphqlFailure(
  errors: Array<{ extensions?: { code?: string } }>,
): LinearFailure {
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

export class LinearClient {
  private readonly apiUrl: URL | undefined

  constructor(
    private readonly config: LinearConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl = endpoint(config.linear.apiUrl)
  }

  async findIssueByMarker(
    marker: string,
  ): Promise<LinearResult<LinearIssueReference | undefined>> {
    if (!this.config.linear.teamId) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        ambiguous: false,
      }
    }
    let after: string | null = null
    for (let page = 0; page < 5; page += 1) {
      const result: LinearResult<DuplicateQueryResponse> = await this.graphql(
        `query SupportResearchFindDuplicate($teamId: String!, $after: String) {
        team(id: $teamId) {
          issues(first: 50, after: $after) {
            nodes { id url description }
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
      const issue = connection?.nodes.find(
        (item: z.infer<typeof issueSchema>) =>
          item.description?.includes(marker),
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

  async createIssue(
    draft: SupportActionDraft,
  ): Promise<LinearResult<LinearIssueReference>> {
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
      `mutation SupportResearchCreateIssue($input: IssueCreateInput!) {
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
    return {
      ok: true,
      value: { id: created.issue.id, url: created.issue.url },
    }
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    mutation: boolean,
  ): Promise<LinearResult<T>> {
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
          "user-agent": "forge-mastra-support-research/1.0",
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
    const body = await readResponseJsonCapped(
      response,
      this.config.maxResponseBytes,
    )
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
