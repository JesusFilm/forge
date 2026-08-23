import "server-only"

import { z } from "zod"

import { env } from "@/env"
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CONTENT_SCOPES,
  FEEDBACK_LANGUAGE_AREAS,
  type FeedbackSubmission,
} from "@/lib/feedback"

const boundedString = (max: number) => z.string().trim().min(1).max(max)

const publicUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    )
  })

export const feedbackSubmissionSchema = z
  .object({
    category: z.enum(FEEDBACK_CATEGORIES),
    message: boundedString(1000).refine((value) => value.length >= 10),
    name: boundedString(100),
    email: z.email().max(254).optional(),
    page: z
      .object({
        title: boundedString(200),
        url: publicUrlSchema,
        locale: boundedString(64),
      })
      .strict(),
    languageIssue: z
      .object({
        area: z.enum(FEEDBACK_LANGUAGE_AREAS),
        language: boundedString(100),
      })
      .strict()
      .optional(),
    content: z
      .object({
        scope: z.enum(FEEDBACK_CONTENT_SCOPES),
        title: boundedString(200),
        url: publicUrlSchema.optional(),
        id: boundedString(100).optional(),
        slug: boundedString(200).optional(),
        label: boundedString(50).optional(),
      })
      .strict()
      .optional(),
    selectedElement: z
      .object({
        label: boundedString(160),
        role: boundedString(50),
        path: boundedString(500),
      })
      .strict()
      .optional(),
    diagnostics: z
      .object({
        browser: boundedString(100),
        operatingSystem: boundedString(100),
        device: boundedString(50),
        viewport: boundedString(100),
        timeZone: boundedString(100),
        appVersion: boundedString(100),
      })
      .strict()
      .optional(),
    website: z.string().max(200).optional(),
  })
  .strict()

const linearResponseSchema = z.object({
  data: z
    .object({
      issueCreate: z.object({
        success: z.boolean(),
        issue: z.object({ id: z.string().min(1) }).nullable(),
      }),
    })
    .optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
})

export type FeedbackLinearFailureReason =
  | "config_missing"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "rejected"
  | "invalid_response"

export type FeedbackLinearResult =
  | { ok: true }
  | { ok: false; reason: FeedbackLinearFailureReason; retryable: boolean }

const LINEAR_ENDPOINT = "https://api.linear.app/graphql"
const LINEAR_TIMEOUT_MS = 6000
const LINEAR_RESPONSE_MAX_BYTES = 64 * 1024

function escapeMarkdown(value: string): string {
  return value
    .replace(/[\\`*_{}()#+\-.!|>]/g, "\\$&")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/@/g, "@\u200b")
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || "Feedback"
}

function issueTitle(submission: FeedbackSubmission): string {
  const category =
    submission.category.charAt(0).toUpperCase() + submission.category.slice(1)
  return `[Watch feedback] ${category}: ${firstLine(submission.message)}`.slice(
    0,
    120,
  )
}

function issueDescription(submission: FeedbackSubmission): string {
  const lines = [
    "## Feedback",
    "",
    escapeMarkdown(submission.message),
    "",
    "## Triage context",
    "",
    `- **Category:** ${escapeMarkdown(submission.category)}`,
    `- **Reporter:** ${escapeMarkdown(submission.name)}`,
    `- **Email:** ${submission.email ? escapeMarkdown(submission.email) : "Not provided"}`,
    `- **Page:** ${escapeMarkdown(submission.page.title)}`,
    `- **URL:** ${escapeMarkdown(submission.page.url)}`,
    `- **Locale:** ${escapeMarkdown(submission.page.locale)}`,
  ]

  if (submission.selectedElement) {
    lines.push(
      "",
      "## Selected page element",
      "",
      `- **Label:** ${escapeMarkdown(submission.selectedElement.label)}`,
      `- **Role:** ${escapeMarkdown(submission.selectedElement.role)}`,
      `- **Path:** \`${submission.selectedElement.path.replace(/`/g, "")}\``,
    )
  }

  if (submission.languageIssue) {
    lines.push(
      "",
      "## Language context",
      "",
      `- **Area:** ${escapeMarkdown(submission.languageIssue.area)}`,
      `- **Affected language:** ${escapeMarkdown(submission.languageIssue.language)}`,
    )
  }

  if (submission.content) {
    lines.push(
      "",
      "## Content context",
      "",
      `- **Scope:** ${escapeMarkdown(submission.content.scope)}`,
      `- **Title:** ${escapeMarkdown(submission.content.title)}`,
    )
    if (submission.content.url) {
      lines.push(`- **URL:** ${escapeMarkdown(submission.content.url)}`)
    }
    if (submission.content.id) {
      lines.push(`- **Content ID:** ${escapeMarkdown(submission.content.id)}`)
    }
    if (submission.content.slug) {
      lines.push(`- **Slug:** ${escapeMarkdown(submission.content.slug)}`)
    }
    if (submission.content.label) {
      lines.push(`- **Type:** ${escapeMarkdown(submission.content.label)}`)
    }
  }

  if (submission.diagnostics) {
    lines.push(
      "",
      "## User-approved technical details",
      "",
      `- **Browser:** ${escapeMarkdown(submission.diagnostics.browser)}`,
      `- **Operating system:** ${escapeMarkdown(submission.diagnostics.operatingSystem)}`,
      `- **Device:** ${escapeMarkdown(submission.diagnostics.device)}`,
      `- **Viewport:** ${escapeMarkdown(submission.diagnostics.viewport)}`,
      `- **Time zone:** ${escapeMarkdown(submission.diagnostics.timeZone)}`,
      `- **App version:** ${escapeMarkdown(submission.diagnostics.appVersion)}`,
    )
  }

  lines.push("", "---", "Submitted through the public Watch feedback form.")
  return lines.join("\n")
}

async function readJsonCapped(response: Response): Promise<unknown> {
  if (!response.body) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > LINEAR_RESPONSE_MAX_BYTES) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    return undefined
  }
}

export async function createLinearFeedbackIssue(
  submission: FeedbackSubmission,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedbackLinearResult> {
  const apiKey = env.WEB_FEEDBACK_LINEAR_API_KEY
  const teamId = env.WEB_FEEDBACK_LINEAR_TEAM_ID
  if (!apiKey || !teamId) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const input = {
    teamId,
    title: issueTitle(submission),
    description: issueDescription(submission),
    ...(env.WEB_FEEDBACK_LINEAR_PROJECT_ID
      ? { projectId: env.WEB_FEEDBACK_LINEAR_PROJECT_ID }
      : {}),
    ...(env.WEB_FEEDBACK_LINEAR_LABEL_ID
      ? { labelIds: [env.WEB_FEEDBACK_LINEAR_LABEL_ID] }
      : {}),
  }

  try {
    const response = await fetchImpl(LINEAR_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: apiKey,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "forge-web-feedback/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
      body: JSON.stringify({
        query: `mutation CreateWatchFeedback($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id }
          }
        }`,
        variables: { input },
      }),
    })

    if (!response.ok) {
      await response.body?.cancel()
      return {
        ok: false,
        reason: response.status === 429 ? "rate_limited" : "rejected",
        retryable: response.status === 429 || response.status >= 500,
      }
    }

    const parsed = linearResponseSchema.safeParse(
      await readJsonCapped(response),
    )
    if (
      !parsed.success ||
      parsed.data.errors?.length ||
      !parsed.data.data?.issueCreate.success ||
      !parsed.data.data.issueCreate.issue
    ) {
      return { ok: false, reason: "invalid_response", retryable: false }
    }
    return { ok: true }
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name
    return {
      ok: false,
      reason:
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "network_error",
      retryable: true,
    }
  }
}
