// KTD1, KTD11, KTD14 — the push.* tools act as the signed-in person, return an
// envelope for each expected failure (a thrown error reaches the agent with no
// field), and never send: no import of dispatch.ts, campaign.service.ts, or workflows.
import { Prisma, PushCampaignStatus, type PrismaClient } from "@prisma/client"
import { z } from "zod"

import { isAdminMcpRole } from "@/auth/admin-mcp-oauth"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { ForbiddenError } from "@/services/errors"
import {
  countPushAgentAudience,
  isPushSendingEnabled,
  listPushAgentCampaigns,
  PUSH_AGENT_CAMPAIGN_LIST_MAX_LIMIT,
  readCampaignDestination,
  readPushAgentCampaign,
  searchPushAgentDestinations,
  searchPushAgentLanguages,
  type PushAgentCampaignDestination,
} from "@/services/push/agent-reads.service"
import {
  createPushCampaignContent,
  writePushCampaignContent,
  type PushCampaignAiMarker,
  type PushCampaignContentWriteResult,
} from "@/services/push/campaign-content.service"
import {
  PUSH_MAX_COPY_ROWS,
  PUSH_MAX_LANGUAGE_FILTER,
  PushAudienceInputSchema,
  PushCampaignCreateInputSchema,
  PushCampaignPatchInputSchema,
  PushDestinationKindSchema,
  PushLanguageSlugSchema,
} from "@/services/push/contracts"
import {
  PushFrozenError,
  PushInputError,
  PushNotFoundError,
  PushStaleContentVersionError,
  PushTooManyCopyRowsError,
  PushUnknownDestinationError,
  PushUnknownLanguageError,
  type PushInputIssue,
} from "@/services/push/errors"
import {
  formatPushReceiptsClock,
  readPushTestRunState,
  type PushTestRunState,
} from "@/services/push/test-run-state"

type ToolArgs = { input: unknown; user: Principal | null }

export type PushToolFailureReason =
  | "invalid_input"
  | "unknown_language"
  | "unknown_destination"
  | "not_found"
  | "not_editable"
  | "stale_revision"
  | "too_many_rows"

/** KTD13 — the closed set of warnings a result can carry. */
export type PushToolWarningCode =
  | "destination_not_published"
  | "destination_missing"
  | "test_invalidated"
  | "test_run_superseded"
  | "language_filter_set"
  | "language_filter_mismatch"
  | "sending_disabled"

export type PushToolWarning = Readonly<{
  code: PushToolWarningCode
  message: string
}>

const CampaignIdSchema = z.string().trim().min(1).max(191)

const LanguageSearchInput = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    slugs: z
      .array(PushLanguageSlugSchema)
      .min(1)
      .max(PUSH_MAX_LANGUAGE_FILTER)
      .optional(),
  })
  .strict()
  .refine((input) => (input.q === undefined) !== (input.slugs === undefined), {
    message: "Pass q or slugs, not both",
    path: ["q"],
  })

const DestinationSearchInput = z
  .object({
    q: z.string().trim().min(1).max(200),
    kind: PushDestinationKindSchema.optional(),
  })
  .strict()

const CampaignListInput = z
  .object({
    statuses: z
      .array(z.enum(PushCampaignStatus))
      .max(Object.values(PushCampaignStatus).length)
      .optional(),
    q: z.string().trim().max(100).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PUSH_AGENT_CAMPAIGN_LIST_MAX_LIMIT)
      .optional(),
  })
  .strict()

const CampaignReadInput = z
  .object({
    campaignId: CampaignIdSchema,
    languages: z
      .array(PushLanguageSlugSchema)
      .min(1)
      .max(PUSH_MAX_COPY_ROWS)
      .optional(),
  })
  .strict()

/** The update's own fields; the rest of the call is the KTD7 patch. */
const UpdateTargetInput = z.object({
  campaignId: CampaignIdSchema,
  expectedRevision: z.number().int().min(0),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** R14 — one issue per field to fix. A zod v4 message never holds the value. */
function issuesOf(error: z.ZodError): PushInputIssue[] {
  return error.issues.flatMap((issue) => {
    const path = issue.path.map(String)
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: [...path, key].join("."),
        message: "This tool does not take this field",
      }))
    }
    return [{ path: path.join("."), message: issue.message }]
  })
}

function failure<R extends PushToolFailureReason, E extends object>(
  reason: R,
  message: string,
  extra: E,
) {
  return { ok: false as const, reason, retryable: false, message, ...extra }
}

function invalidInput(issues: readonly PushInputIssue[]) {
  return failure(
    "invalid_input",
    "The input breaks a campaign rule. Fix each field in issues, then call again. Nothing was saved.",
    { issues },
  )
}

function notFound() {
  return failure(
    "not_found",
    "Admin has no campaign with this campaignId. Find the campaign with push.campaign.list.",
    {},
  )
}

type PushWriteCall = Readonly<{
  tool: "push.campaign.create" | "push.campaign.update"
  campaignId: string | null
  actorId: string
}>

/** Token characters only, so a value from a caller cannot forge a log field. */
function logToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) || "none"
}

// A Zod or Prisma message can hold copy text, so the line carries only the
// error's name and its Prisma code. The route answers with no detail.
function logWriteError(error: unknown, call: PushWriteCall): void {
  const name = error instanceof Error ? error.name : typeof error
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "none"
  const campaign = call.campaignId === null ? "none" : logToken(call.campaignId)
  console.error(
    `[push-mcp] event=write_error tool=${call.tool} campaign=${campaign} actor=${call.actorId} name=${logToken(name)} code=${logToken(code)}`,
  )
}

/** KTD11 — maps an expected push failure to its envelope; logs and rethrows the rest. */
function failureOf(error: unknown, call: PushWriteCall) {
  if (error instanceof PushInputError) {
    return invalidInput(
      error.issues.length > 0
        ? error.issues
        : [{ path: "", message: error.message }],
    )
  }
  if (error instanceof PushUnknownLanguageError) {
    return failure(
      "unknown_language",
      `Admin does not know these languages: ${error.slugs.join(", ")}. Find each slug with push.language.search. Nothing was saved.`,
      { slugs: error.slugs },
    )
  }
  if (error instanceof PushUnknownDestinationError) {
    return failure(
      "unknown_destination",
      `${error.message}. Find the destination with push.destination.search. Nothing was saved.`,
      { kind: error.kind, slug: error.slug, actualKind: error.actualKind },
    )
  }
  if (error instanceof PushNotFoundError) return notFound()
  if (error instanceof PushFrozenError) {
    // PushFrozenError's own message tells a person to cancel, which the agent
    // must never suggest, so the envelope writes its own.
    return failure(
      "not_editable",
      `This campaign is ${error.status}. The agent can change only a DRAFT or TESTED campaign. A person manages this campaign in the dashboard.`,
      { status: error.status },
    )
  }
  if (error instanceof PushStaleContentVersionError) {
    return failure(
      "stale_revision",
      `This campaign changed after you read it, and its revision is now ${error.currentContentVersion}. Read it again with push.campaign.read, then make your change again.`,
      { currentRevision: error.currentContentVersion },
    )
  }
  if (error instanceof PushTooManyCopyRowsError) {
    return failure(
      "too_many_rows",
      `A campaign holds at most ${error.limit} languages, and this change would leave ${error.rowCount}. Nothing was saved.`,
      { rowCount: error.rowCount, limit: error.limit },
    )
  }
  logWriteError(error, call)
  throw error
}

function editorUrlFor(campaignId: string): string {
  return new URL(
    `/dashboard/push-campaigns/${encodeURIComponent(campaignId)}`,
    env.ADMIN_BASE_URL ?? "http://localhost:3003",
  ).toString()
}

function markerOf(marker: PushCampaignAiMarker | null) {
  return marker
    ? { by: marker.actorId, at: marker.writtenAt.toISOString() }
    : null
}

function warningsFor(input: {
  destination: PushAgentCampaignDestination | null
  languages: readonly string[]
  languageFilter: readonly string[]
  testInvalidated: boolean
  testSuperseded: boolean
}): PushToolWarning[] {
  const warnings: PushToolWarning[] = []
  const { destination } = input
  if (destination && !destination.exists) {
    warnings.push({
      code: "destination_missing",
      message: `The destination ${destination.kind} ${destination.slug} no longer exists. Schedule and send now refuse until a person chooses another destination.`,
    })
  } else if (destination && !destination.published) {
    warnings.push({
      code: "destination_not_published",
      message: `The destination ${destination.kind} ${destination.slug} is not published (${destination.reason ?? "unpublished"}). Schedule and send now refuse until it is published.`,
    })
  }
  if (input.testInvalidated) {
    warnings.push({
      code: "test_invalidated",
      message:
        "This change moved the campaign from TESTED back to DRAFT. A person must send a new test.",
    })
  }
  if (input.testSuperseded) {
    warnings.push({
      code: "test_run_superseded",
      message:
        "A test send is still collecting receipts. Its results are for an earlier version of this campaign.",
    })
  }
  if (input.languageFilter.length > 0) {
    warnings.push({
      code: "language_filter_set",
      message:
        "The audience has a language filter. Phones in other languages do not get this campaign.",
    })
    const written = new Set(input.languages)
    const uncovered = input.languageFilter.filter((slug) => !written.has(slug))
    if (uncovered.length > 0) {
      warnings.push({
        code: "language_filter_mismatch",
        message: `The language filter names languages with no copy: ${uncovered.join(", ")}. Phones in those languages get the English copy, unless their other language has copy.`,
      })
    }
  }
  if (!isPushSendingEnabled()) {
    warnings.push({
      code: "sending_disabled",
      message:
        "Sending is turned off on this admin (PUSH_CAMPAIGNS_ENABLED). A person cannot test, schedule, or send until an operator turns it on.",
    })
  }
  return warnings
}

/** R19 — the steps that remain for a person, in order. */
function nextStepsFor(input: {
  status: PushCampaignStatus
  editorUrl: string
  destination: PushAgentCampaignDestination | null
  test: PushTestRunState
}): string[] {
  const steps = [
    `Open the campaign in the dashboard: ${input.editorUrl}`,
    "Check the destination, the audience, and every language.",
  ]
  if (input.destination === null) {
    steps.push(
      "Choose a destination. Schedule and send now refuse a campaign with no destination.",
    )
  } else if (!input.destination.exists || !input.destination.published) {
    steps.push(
      "Publish the destination, or choose a published one. Schedule and send now refuse until then.",
    )
  }
  if (input.status === PushCampaignStatus.TESTED) {
    steps.push(
      "The last test still counts. Schedule the campaign, or send it now.",
    )
    return steps
  }
  steps.push(
    input.test.running
      ? `Wait until about ${formatPushReceiptsClock(input.test.receiptsUntil)} UTC, then send a new test.`
      : "Send a test to a test device.",
    "Then schedule the campaign, or send it now.",
  )
  return steps
}

/** KTD20 — the audit line of each agent write. It never holds copy text. */
function logWrite(
  event: "campaign_created" | "campaign_written",
  result: PushCampaignContentWriteResult,
  actorId: string,
): void {
  const { added, updated, removed } = result.changed.languages
  const statusChange = result.statusChange
    ? `${result.statusChange.from}->${result.statusChange.to}`
    : "none"
  console.info(
    `[push-mcp] event=${event} campaign=${result.campaignId} actor=${actorId} added=${added.length} updated=${updated.length} removed=${removed.length} status_change=${statusChange}`,
  )
}

/** The `push.*` tools: each method checks the caller before it reads anything. */
export class PushCampaignMcpService {
  constructor(private readonly prisma: PrismaClient) {}

  async searchLanguages({ input, user }: ToolArgs) {
    this.authorize(user)
    const parsed = LanguageSearchInput.safeParse(input)
    if (!parsed.success) return invalidInput(issuesOf(parsed.error))
    const { q, slugs } = parsed.data
    const result = await searchPushAgentLanguages(
      this.prisma,
      slugs !== undefined ? { slugs } : { q: q ?? "" },
    )
    return { ok: true as const, ...result }
  }

  async searchDestinations({ input, user }: ToolArgs) {
    this.authorize(user)
    const parsed = DestinationSearchInput.safeParse(input)
    if (!parsed.success) return invalidInput(issuesOf(parsed.error))
    const result = await searchPushAgentDestinations(this.prisma, parsed.data)
    return { ok: true as const, ...result }
  }

  async countAudience({ input, user }: ToolArgs) {
    this.authorize(user)
    const parsed = PushAudienceInputSchema.safeParse(input)
    if (!parsed.success) return invalidInput(issuesOf(parsed.error))
    const result = await countPushAgentAudience(this.prisma, {
      campaign: {
        audienceScope: parsed.data.scope,
        countries: parsed.data.countries,
        languageFilter: parsed.data.languageFilter,
      },
    })
    return { ok: true as const, ...result }
  }

  async listCampaigns({ input, user }: ToolArgs) {
    this.authorize(user)
    const parsed = CampaignListInput.safeParse(input)
    if (!parsed.success) return invalidInput(issuesOf(parsed.error))
    const result = await listPushAgentCampaigns(this.prisma, parsed.data)
    return {
      ok: true as const,
      campaigns: result.campaigns.map((row) => ({
        ...row,
        aiMarker: markerOf(row.aiMarker),
      })),
      truncated: result.truncated,
    }
  }

  async readCampaign({ input, user }: ToolArgs) {
    this.authorize(user)
    const parsed = CampaignReadInput.safeParse(input)
    if (!parsed.success) return invalidInput(issuesOf(parsed.error))
    const campaign = await readPushAgentCampaign(this.prisma, parsed.data)
    if (campaign === null) return notFound()
    return {
      ok: true as const,
      ...campaign,
      aiMarker: markerOf(campaign.aiMarker),
      editorUrl: editorUrlFor(campaign.campaignId),
      warnings: warningsFor({
        destination: campaign.destination,
        languages: campaign.languages,
        languageFilter: campaign.audience.languageFilter,
        testInvalidated: false,
        testSuperseded: false,
      }),
    }
  }

  async createCampaign({ input, user }: ToolArgs) {
    const actorId = this.authorize(user)
    const parsed = PushCampaignCreateInputSchema.safeParse(input)
    if (!parsed.success) return invalidInput(issuesOf(parsed.error))
    let result: PushCampaignContentWriteResult
    try {
      result = await createPushCampaignContent(this.prisma, {
        actorId,
        content: parsed.data,
      })
    } catch (error) {
      return failureOf(error, {
        tool: "push.campaign.create",
        campaignId: null,
        actorId,
      })
    }
    logWrite("campaign_created", result, actorId)
    return this.writeResult(result)
  }

  async updateCampaign({ input, user }: ToolArgs) {
    const actorId = this.authorize(user)
    const { campaignId, expectedRevision, ...patchInput } = isRecord(input)
      ? input
      : {}
    const target = UpdateTargetInput.safeParse({ campaignId, expectedRevision })
    const patch = PushCampaignPatchInputSchema.safeParse(patchInput)
    if (!target.success || !patch.success) {
      return invalidInput([
        ...(target.success ? [] : issuesOf(target.error)),
        ...(patch.success ? [] : issuesOf(patch.error)),
      ])
    }
    let result: PushCampaignContentWriteResult
    try {
      result = await writePushCampaignContent(this.prisma, {
        source: "mcp",
        campaignId: target.data.campaignId,
        actorId,
        expectedContentVersion: target.data.expectedRevision,
        patch: patch.data,
      })
    } catch (error) {
      return failureOf(error, {
        tool: "push.campaign.update",
        campaignId: target.data.campaignId,
        actorId,
      })
    }
    if (result.written) logWrite("campaign_written", result, actorId)
    return this.writeResult(result)
  }

  // R2, R3 — the role rule runs first: `write:push-campaigns` is VIEWER-tier,
  // so the dashboard permission alone would admit a VIEWER.
  private authorize(user: Principal | null): string {
    if (user === null || user.id === null || !isAdminMcpRole(user.role)) {
      throw new ForbiddenError()
    }
    if (!hasPermission(user, "write:push-campaigns")) {
      throw new ForbiddenError()
    }
    return user.id
  }

  /** KTD13 — one result for create and update. */
  private async writeResult(result: PushCampaignContentWriteResult) {
    const { after } = result
    const [destination, test] = await Promise.all([
      readCampaignDestination(this.prisma, after.destination),
      readPushTestRunState(this.prisma, after.campaignId),
    ])
    const editorUrl = editorUrlFor(after.campaignId)
    const languages = after.copies.map((copy) => copy.languageSlug)
    return {
      ok: true as const,
      campaign: {
        id: after.campaignId,
        status: after.status,
        revision: after.contentVersion,
      },
      statusChange: result.statusChange,
      editorUrl,
      changed: result.changed,
      languages,
      warnings: warningsFor({
        destination,
        languages,
        languageFilter: after.audience.languageFilter,
        testInvalidated:
          result.statusChange?.from === PushCampaignStatus.TESTED &&
          result.statusChange.to === PushCampaignStatus.DRAFT,
        testSuperseded: result.written && test.running,
      }),
      nextSteps: nextStepsFor({
        status: after.status,
        editorUrl,
        destination,
        test,
      }),
      aiMarker: markerOf(after.aiMarker),
    }
  }
}
