import { requireConfig } from "./config"

type GraphqlResult<T> = { data?: T; errors?: Array<{ message: string }> }

async function request<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const secret = requireConfig(
    "FEEDBACK_LINEAR_API_KEY",
  ).FEEDBACK_LINEAR_API_KEY
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      authorization: secret,
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "forge-tv-feedback/1.0",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      response.status === 429 ? "linear_rate_limited" : "linear_unavailable",
    )
  }
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > 64 * 1024) throw new Error("linear_response_large")
  const text = await response.text()
  if (text.length > 64 * 1024) throw new Error("linear_response_large")
  const parsed = JSON.parse(text) as GraphqlResult<T>
  if (parsed.errors?.length || !parsed.data) throw new Error("linear_rejected")
  return parsed.data
}

function escape(value: string): string {
  return value
    .replace(/[\\`*_{}()+#.!|>-]/g, "\\$&")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/@/g, "@\u200b")
}

export type ReportForLinear = {
  id: string
  category: string
  message: string
  expected: string | null
  steps: string | null
  blocked: boolean
  tv_context: Record<string, unknown>
  phone_context: Record<string, unknown> | null
  name: string | null
  email: string | null
}

export function issueContent(report: ReportForLinear): {
  title: string
  description: string
} {
  const tv = report.tv_context
  const platform = typeof tv.platform === "string" ? tv.platform : "unknown"
  const feature = typeof tv.feature === "string" ? tv.feature : "general"
  const first = report.message.replace(/\s+/g, " ").slice(0, 74)
  const title = `[TV beta][${platform}][${feature}] ${first}`.slice(0, 120)
  const entries: Array<[string, unknown]> = [
    ["Report reference", report.id],
    ["Category", report.category],
    ["Platform", platform],
    ["Feature", feature],
    ["App version", tv.appVersion],
    ["Build", tv.build],
    ["Screen", tv.screen],
    ["Player", tv.player],
    ["Film", tv.filmTitle],
    ["Audio", tv.audioLanguage],
    ["Subtitles", tv.subtitleLanguage],
    ["Film timestamp", tv.timestamp],
    ["Playback blocked", report.blocked ? "Yes" : "No"],
    ["Reporter", report.name],
    ["Reply email", report.email],
  ]
  const description = [
    "## Feedback",
    "",
    escape(report.message),
    "",
    ...(report.expected
      ? ["## Expected result", "", escape(report.expected), ""]
      : []),
    ...(report.steps
      ? ["## Steps to reproduce", "", escape(report.steps), ""]
      : []),
    "## TV context",
    "",
    ...entries
      .filter(([, value]) => value != null && value !== "")
      .map(([name, value]) => `- **${name}:** ${escape(String(value))}`),
    ...(report.phone_context
      ? [
          "",
          "## Submitting phone (approved separately)",
          "",
          ...Object.entries(report.phone_context).map(
            ([name, value]) =>
              `- **${escape(name)}:** ${escape(String(value))}`,
          ),
        ]
      : []),
    "",
    "Submitted from the Watch TV beta feedback page.",
  ].join("\n")
  return { title, description }
}

export async function createIssue(report: ReportForLinear): Promise<string> {
  const config = requireConfig("FEEDBACK_LINEAR_TEAM_ID")
  const payload = issueContent(report)
  const input = {
    teamId: config.FEEDBACK_LINEAR_TEAM_ID,
    ...payload,
    ...(config.FEEDBACK_LINEAR_PROJECT_ID
      ? { projectId: config.FEEDBACK_LINEAR_PROJECT_ID }
      : {}),
    ...(config.FEEDBACK_LINEAR_LABEL_ID
      ? { labelIds: [config.FEEDBACK_LINEAR_LABEL_ID] }
      : {}),
  }
  const data = await request<{
    issueCreate: { success: boolean; issue: { id: string } | null }
  }>(
    "mutation CreateTvFeedback($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id } } }",
    { input },
  )
  if (!data.issueCreate.success || !data.issueCreate.issue?.id)
    throw new Error("linear_issue_rejected")
  return data.issueCreate.issue.id
}

export async function findIssueByReference(
  reference: string,
): Promise<string | null> {
  const teamId = requireConfig(
    "FEEDBACK_LINEAR_TEAM_ID",
  ).FEEDBACK_LINEAR_TEAM_ID
  const data = await request<{
    issues: { nodes: Array<{ id: string; description: string | null }> }
  }>(
    "query FindTvFeedback($teamId: ID!, $reference: String!) { issues(first: 2, filter: { team: { id: { eq: $teamId } }, description: { contains: $reference } }) { nodes { id description } } }",
    { teamId, reference },
  )
  const exact = data.issues.nodes.filter(
    (issue) =>
      issue.description?.includes(
        `**Report reference:** ${escape(reference)}`,
      ) || issue.description?.includes(`**Report reference:** ${reference}`),
  )
  if (exact.length > 1) throw new Error("duplicate_linear_reference")
  return exact[0]?.id ?? null
}

export async function uploadMedia(
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const size = bytes.length
  const data = await request<{
    fileUpload: {
      success: boolean
      uploadFile: {
        uploadUrl: string
        assetUrl: string
        headers: Array<{ key: string; value: string }>
      } | null
    }
  }>(
    "mutation UploadTvEvidence($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }",
    { contentType, filename, size },
  )
  const upload = data.fileUpload.uploadFile
  if (!data.fileUpload.success || !upload)
    throw new Error("linear_upload_rejected")
  const destination = new URL(upload.uploadUrl)
  if (
    destination.protocol !== "https:" ||
    !/\.(linear\.app|googleapis\.com|amazonaws\.com)$/.test(
      destination.hostname,
    )
  )
    throw new Error("linear_upload_host_invalid")
  const headers = new Headers({ "Content-Type": contentType })
  for (const { key: name, value } of upload.headers) headers.set(name, value)
  const response = await fetch(destination, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers,
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error("linear_upload_failed")
  }
  const asset = new URL(upload.assetUrl)
  if (asset.protocol !== "https:" || asset.hostname !== "uploads.linear.app")
    throw new Error("linear_asset_invalid")
  return asset.toString()
}

export async function attachMedia(
  issueId: string,
  filename: string,
  assetUrl: string,
): Promise<void> {
  const data = await request<{ attachmentCreate: { success: boolean } }>(
    "mutation AttachTvEvidence($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }",
    { input: { issueId, title: filename, url: assetUrl } },
  )
  if (!data.attachmentCreate.success)
    throw new Error("linear_attachment_rejected")
}
