import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../config/seo"
import { minimizeSeoText } from "./seo-data-minimization"
import { classifySeoHttpStatus, readSeoJson, validateSeoUrl } from "./seo-http"

const LINEAR_URL = "https://api.linear.app/graphql"

const IssueSchema = z
  .object({
    id: z.string(),
    url: z.string().url(),
    title: z.string(),
    description: z.string().nullable(),
    team: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough()

export type LinearTicket = z.infer<typeof IssueSchema>
export type LinearTicketFailure = {
  ok: false
  reason:
    | "config_missing"
    | "auth_failed"
    | "rate_limited"
    | "timeout"
    | "network_error"
    | "rejected"
    | "parse_error"
    | "ambiguous"
  retryable: boolean
  ambiguous: boolean
  candidates?: LinearTicket[]
  status?: number
}

async function linearGraphql(
  query: string,
  variables: Record<string, unknown>,
  options: {
    config?: SeoConfig
    fetchImpl?: typeof fetch
    resolveHost?: Parameters<typeof validateSeoUrl>[1]["resolveHost"]
  } = {},
): Promise<{ ok: true; data: unknown } | LinearTicketFailure> {
  const config = options.config ?? getSeoConfig()
  if (!config.linear.apiKey || !config.linear.teamId) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: true,
      ambiguous: false,
    }
  }
  const safe = await validateSeoUrl(LINEAR_URL, {
    allowedHosts: ["api.linear.app"],
    allowQuery: false,
    resolveHost: options.resolveHost,
  })
  if (!safe.ok) {
    return { ok: false, reason: "rejected", retryable: false, ambiguous: false }
  }
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(safe.url, {
      method: "POST",
      headers: {
        authorization: config.linear.apiKey,
        "content-type": "application/json",
        "user-agent": "forge-mastra-seo/1.0",
      },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "timeout"
          : "network_error",
      retryable: false,
      ambiguous: true,
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      ...classifySeoHttpStatus(response.status),
      ambiguous: false,
    }
  }
  const body = await readSeoJson(response, config.maxResponseBytes)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: true,
      ambiguous: false,
    }
  }
  const record = body as { data?: unknown; errors?: unknown }
  if (record.errors) {
    return { ok: false, reason: "rejected", retryable: false, ambiguous: false }
  }
  return { ok: true, data: record.data }
}

export async function reconcileLinearTicket(
  input: { marker: string; payloadDigest: string },
  options: Parameters<typeof linearGraphql>[2] = {},
): Promise<
  | { ok: true; status: "found"; ticket: LinearTicket }
  | { ok: true; status: "not_found" }
  | LinearTicketFailure
> {
  const config = options.config ?? getSeoConfig()
  if (!config.linear.teamId) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: true,
      ambiguous: false,
    }
  }
  const result = await linearGraphql(
    `query SeoTicketReconcile($teamId: ID!, $query: String!) {
      issues(first: 25, filter: { team: { id: { eq: $teamId } }, or: [
        { title: { containsIgnoreCase: $query } },
        { description: { containsIgnoreCase: $query } }
      ] }) { nodes { id url title description team { id } } }
    }`,
    { teamId: config.linear.teamId, query: input.marker },
    options,
  )
  if (!result.ok) return result
  const parsed = z
    .object({
      issues: z.object({ nodes: z.array(IssueSchema).max(25) }).strict(),
    })
    .strict()
    .safeParse(result.data)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: true,
      ambiguous: false,
    }
  }
  const exact = parsed.data.issues.nodes.filter(
    (ticket) =>
      ticket.team.id === config.linear.teamId &&
      (ticket.description ?? "").includes(input.marker) &&
      (ticket.description ?? "").includes(input.payloadDigest),
  )
  if (exact.length === 1)
    return { ok: true, status: "found", ticket: exact[0]! }
  if (exact.length === 0) return { ok: true, status: "not_found" }
  return {
    ok: false,
    reason: "ambiguous",
    retryable: false,
    ambiguous: true,
    candidates: exact,
  }
}

export async function createLinearTicket(
  input: {
    marker: string
    payloadDigest: string
    brief: {
      title: string
      description: string
      acceptanceCriteria: string[]
      affectedScope: string[]
    }
  },
  options: Parameters<typeof linearGraphql>[2] = {},
): Promise<{ ok: true; ticket: LinearTicket } | LinearTicketFailure> {
  const config = options.config ?? getSeoConfig()
  if (!config.linear.teamId) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: true,
      ambiguous: false,
    }
  }
  const reconciliationIdentity = [
    input.marker,
    `Payload digest: ${input.payloadDigest}`,
  ].join("\n")
  const readableBrief = [
    input.brief.description,
    "",
    "Acceptance criteria",
    ...input.brief.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    `Affected scope: ${input.brief.affectedScope.join(", ")}`,
  ].join("\n")
  const identitySuffix = `\n\n${reconciliationIdentity}`
  const description = `${minimizeSeoText(
    readableBrief,
    8_000 - identitySuffix.length,
  )}${identitySuffix}`
  const result = await linearGraphql(
    `mutation SeoTicketCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id url title description team { id } } }
    }`,
    {
      input: {
        teamId: config.linear.teamId,
        title: minimizeSeoText(input.brief.title, 500),
        description,
        ...(config.linear.projectId
          ? { projectId: config.linear.projectId }
          : {}),
        ...(config.linear.labelIds.length
          ? { labelIds: config.linear.labelIds }
          : {}),
      },
    },
    options,
  )
  if (!result.ok) {
    if (result.reason === "parse_error" || (result.status ?? 0) >= 500) {
      return { ...result, retryable: false, ambiguous: true }
    }
    return result
  }
  const parsed = z
    .object({
      issueCreate: z
        .object({ success: z.literal(true), issue: IssueSchema })
        .strict(),
    })
    .strict()
    .safeParse(result.data)
  return parsed.success
    ? { ok: true, ticket: parsed.data.issueCreate.issue }
    : { ok: false, reason: "parse_error", retryable: false, ambiguous: true }
}
