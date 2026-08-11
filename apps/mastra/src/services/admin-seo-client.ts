import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../config/seo"
import type { SeoProposal } from "../mastra/tools/seo-analysis"
import {
  createSeoWorkloadAssertion,
  type SeoWorkloadCapability,
} from "./admin-seo-assertion"
import { minimizeSeoValue } from "./seo-data-minimization"
import {
  digestSeoProposalPayload,
  digestSeoValue,
  seoPersistenceProposalPayload,
} from "./seo-digest"
import type { SeoEvidenceObservation } from "./seo-evidence"
import { classifySeoHttpStatus, readSeoJson, validateSeoUrl } from "./seo-http"

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const BoundedIdSchema = z.string().trim().min(1).max(191)
const RunRecordSchema = z
  .object({
    runId: BoundedIdSchema,
    idempotencyKey: BoundedIdSchema,
    mode: z.enum(["OFF", "DRY_RUN", "LIVE"]),
    status: z.string().max(100),
    replayed: z.boolean(),
  })
  .passthrough()

const RawTargetSchema = z
  .object({
    targetId: BoundedIdSchema,
    targetType: z.enum(["VideoLocale", "ExperienceLocale"]),
    canonicalUrl: z.string().url().max(2_000),
    locale: z.string().min(1).max(35),
    baseContentHash: DigestSchema,
    canonicalIdentityDigest: DigestSchema,
    preChangeSnapshot: z
      .object({ v: z.literal(1), data: z.record(z.string(), z.unknown()) })
      .strict(),
    supportedFields: z.array(z.string().max(191)).max(100),
  })
  .strict()

const StartRunRequestSchema = z
  .object({
    action: z.literal("start_run"),
    idempotencyKey: BoundedIdSchema,
    mode: z.enum(["off", "dry_run", "live"]),
    windowStart: z.string().datetime().nullable().optional(),
    windowEnd: z.string().datetime().nullable().optional(),
    targetLimit: z.number().int().min(1).max(5_000).default(1_000),
    leaseSeconds: z.number().int().min(60).max(1_800).default(900),
  })
  .strict()

const AdminObservationSchema = z
  .object({
    observationKey: BoundedIdSchema,
    provider: z.enum([
      "gsc",
      "ga4",
      "firecrawl",
      "direct_page",
      "grounded_search",
    ]),
    schemaVersion: z.number().int().positive().max(100).default(1),
    scope: z.unknown().default({}),
    payload: z.unknown(),
    citations: z.unknown().default([]),
    quality: z.unknown().default({}),
    payloadDigest: DigestSchema,
    retrievedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()

const AdminProposalSchema = z
  .object({
    proposalId: BoundedIdSchema,
    version: z.number().int().positive(),
    idempotencyKey: BoundedIdSchema,
    payloadDigest: DigestSchema,
    semanticConflictKey: z.string().min(1).max(512),
    lane: z.enum(["editorial", "engineering", "rollback"]),
    targetType: z.enum(["VideoLocale", "ExperienceLocale", "Engineering"]),
    targetId: BoundedIdSchema.nullable(),
    canonicalUrl: z.string().url().max(2_000),
    locale: z.string().min(1).max(35),
    canonicalIdentityDigest: DigestSchema,
    baseContentHash: DigestSchema.nullable(),
    intent: z.string().min(1).max(10_000),
    expectedOutcome: z.string().min(1).max(10_000),
    risk: z.string().min(1).max(10_000),
    verificationPlan: z.string().min(1).max(10_000),
    rollbackPlan: z.string().min(1).max(10_000),
    editorialDiff: z.unknown().nullable().default(null),
    engineeringBrief: z.unknown().nullable().default(null),
    evidence: z.unknown().default([]),
    caveats: z.array(z.string().max(2_000)).max(100).default([]),
    affectedFields: z.array(z.string().max(191)).max(100).default([]),
    payload: z.unknown(),
    preChangeSnapshot: z.unknown(),
    treatmentSnapshot: z.unknown(),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const SeoRunReportSchema = z
  .object({
    eligibleCount: z.number().int().nonnegative(),
    observedCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    wouldProposeCount: z.number().int().nonnegative(),
    persistedProposalCount: z.number().int().nonnegative(),
    providerCoverage: z.record(
      z.string(),
      z.enum(["available", "partial", "unavailable"]),
    ),
    skippedTargetIds: z.array(z.string()).max(10_000),
    suppressedOperations: z.array(z.string()).max(100),
  })
  .strict()
export type SeoRunReport = z.infer<typeof SeoRunReportSchema>

const CompleteRunRequestSchema = z
  .object({
    action: z.literal("complete_run"),
    runId: BoundedIdSchema,
    claimGeneration: z.number().int().positive(),
    claimToken: BoundedIdSchema,
    status: z.enum(["completed", "partial", "failed"]),
    providerCoverage: z.unknown().default({}),
    report: z.unknown().default({}),
    eligibleCount: z.number().int().nonnegative().default(0),
    selectedCount: z.number().int().nonnegative().default(0),
    wouldProposeCount: z.number().int().nonnegative().default(0),
    suppressedOperations: z.array(z.string().max(191)).max(100).default([]),
    observations: z.array(AdminObservationSchema).max(5_000).default([]),
    proposals: z.array(AdminProposalSchema).max(100).default([]),
  })
  .strict()

export const SeoIngestRequestSchema = z.discriminatedUnion("action", [
  StartRunRequestSchema,
  CompleteRunRequestSchema,
])
export type SeoIngestRequest = z.infer<typeof SeoIngestRequestSchema>

const StartRunResultSchema = RunRecordSchema.extend({
  executionClaim: z
    .object({
      generation: z.number().int().positive(),
      token: BoundedIdSchema,
      expiresAt: z.string().datetime(),
    })
    .strict()
    .nullable(),
  // U4 consumes these server-owned identities. They are optional during an
  // additive rollout so a partially deployed Admin safely produces no work.
  targets: z.array(RawTargetSchema).max(5_000).default([]),
  lessons: z.array(z.unknown()).max(100).default([]),
  coverage: z.unknown().default({}),
}).passthrough()
const SuccessEnvelope = <T extends z.ZodTypeAny>(result: T) =>
  z.object({ ok: z.literal(true), result }).strict()

const ClaimDueRequestSchema = z
  .object({
    action: z.literal("claim_due"),
    claimId: BoundedIdSchema,
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()

const RawExperimentSchema = z
  .object({
    id: BoundedIdSchema,
    claimGeneration: z.number().int().positive(),
    claimToken: BoundedIdSchema,
    status: z.string().max(100),
    preChangeSnapshot: z.unknown(),
    treatmentSnapshot: z.unknown(),
    preChangeHash: DigestSchema,
    treatmentHash: DigestSchema,
    expectedActivationHash: DigestSchema,
    currentCanonicalActivationHash: DigestSchema.nullable(),
    activatedAt: z.coerce.date().nullable(),
    interimDueAt: z.coerce.date().nullable(),
    finalDueAt: z.coerce.date().nullable(),
    confounders: z.unknown(),
    proposalVersion: z
      .object({
        payload: z.unknown(),
        proposal: z
          .object({
            lane: z.string(),
            targetType: z.string(),
            targetId: z.string().nullable(),
            canonicalUrl: z.string().url(),
            locale: z.string(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough()

const RecordEvaluationRequestSchema = z
  .object({
    action: z.literal("record_result"),
    experimentId: BoundedIdSchema,
    claimGeneration: z.number().int().positive(),
    claimToken: BoundedIdSchema,
    kind: z.enum(["activation", "interim", "final"]),
    outcome: z.string().trim().min(1).max(191),
    metrics: z.unknown().default({}),
    evidenceDigest: DigestSchema,
    confounders: z.unknown().default([]),
    observedAt: z.string().datetime(),
    observedActivationHash: DigestSchema.nullable().optional(),
    activatedAt: z.string().datetime().nullable().optional(),
  })
  .strict()

export const SeoEvaluateRequestSchema = z.discriminatedUnion("action", [
  ClaimDueRequestSchema,
  RecordEvaluationRequestSchema,
])
export type SeoEvaluateRequest = z.infer<typeof SeoEvaluateRequestSchema>

const TicketBriefSchema = z
  .object({
    title: z.string().max(500),
    description: z.string().max(10_000),
    acceptanceCriteria: z.array(z.string().max(1_000)).max(20),
    affectedScope: z.array(z.string().max(2_000)).max(20),
  })
  .passthrough()

const TicketClaimResultSchema = z
  .object({
    outboxId: BoundedIdSchema,
    generation: z.number().int().positive(),
    leaseToken: BoundedIdSchema,
    leaseExpiresAt: z.string().datetime(),
    payloadDigest: DigestSchema,
    payload: TicketBriefSchema,
    marker: z.string().min(1).max(500),
    remoteId: z.string().nullable(),
    remoteUrl: z.string().url().nullable(),
  })
  .strict()

const ClaimTicketsRequestSchema = z
  .object({
    action: z.literal("claim"),
    leaseSeconds: z.number().int().min(30).max(900).default(300),
  })
  .strict()
const CompleteTicketRequestSchema = z
  .object({
    action: z.literal("complete"),
    outboxId: BoundedIdSchema,
    generation: z.number().int().positive(),
    leaseToken: BoundedIdSchema,
    remoteId: BoundedIdSchema,
    remoteUrl: z.string().url().max(2_000),
  })
  .strict()
const RetryTicketRequestSchema = z
  .object({
    action: z.literal("retry"),
    outboxId: BoundedIdSchema,
    generation: z.number().int().positive(),
    leaseToken: BoundedIdSchema,
    errorCode: BoundedIdSchema,
    nextAttemptAt: z.string().datetime(),
  })
  .strict()
const ManualTicketRequestSchema = z
  .object({
    action: z.literal("manual_reconcile"),
    outboxId: BoundedIdSchema,
    generation: z.number().int().positive(),
    leaseToken: BoundedIdSchema,
    errorCode: BoundedIdSchema,
    candidates: z.unknown().default([]),
  })
  .strict()
export const SeoTicketsRequestSchema = z.discriminatedUnion("action", [
  ClaimTicketsRequestSchema,
  CompleteTicketRequestSchema,
  RetryTicketRequestSchema,
  ManualTicketRequestSchema,
])
export type SeoTicketsRequest = z.infer<typeof SeoTicketsRequestSchema>

export type SeoExperimentClaim = {
  id: string
  claimGeneration: number
  claimToken: string
  stage: "activation" | "interim" | "final"
  status: string
  lane: "editorial" | "engineering"
  canonicalUrl: string
  treatmentHash: string
  expectedActivationHash: string
  currentCanonicalActivationHash: string | null
  preChangeHash: string
  preChangeSnapshot: unknown
  activatedAt: string | null
  gscPropertyId: string | null
  ga4PropertyId: string | null
  baselineWindow: { startDate: string; endDate: string } | null
  treatmentWindow: { startDate: string; endDate: string } | null
  confounders: string[]
  deploymentProbe: {
    type:
      | "page_text_hash"
      | "structured_data_path"
      | "response_header"
      | "performance_budget"
    canonicalUrl: string
    expectedValue: string
    canonicalizationVersion: string
    timeoutMs: number
    headerName?: string
  } | null
}

export type AdminSeoClientFailure = {
  ok: false
  reason:
    | "config_missing"
    | "not_allowed"
    | "auth_failed"
    | "rate_limited"
    | "timeout"
    | "network_error"
    | "rejected"
    | "parse_error"
  retryable: boolean
  status?: number
}

function addDays(value: string | Date, days: number): string {
  const date = new Date(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function toAdminSeoObservation(
  observation: SeoEvidenceObservation,
): z.infer<typeof AdminObservationSchema> {
  const provider = {
    gsc: "gsc",
    ga4: "ga4",
    firecrawl: "firecrawl",
    openai_web_search: "grounded_search",
    page_fetch: "direct_page",
  }[observation.provider] as z.infer<typeof AdminObservationSchema>["provider"]
  const scope = minimizeSeoValue(observation.scope)
  const payload = minimizeSeoValue(observation.data)
  const citations = minimizeSeoValue(observation.sources)
  const quality = minimizeSeoValue({
    status: observation.status,
    ...observation.quality,
  })
  const projected = {
    provider,
    scope,
    payload,
    citations,
    quality,
    retrievedAt: observation.retrievedAt,
  }
  return AdminObservationSchema.parse({
    observationKey: observation.id,
    provider,
    schemaVersion: 1,
    scope,
    payload,
    citations,
    quality,
    payloadDigest: digestSeoValue(projected),
    retrievedAt: observation.retrievedAt,
    expiresAt: addDays(observation.retrievedAt, 400),
  })
}

export function toAdminSeoProposal(
  proposal: SeoProposal,
  now = new Date(),
): z.infer<typeof AdminProposalSchema> {
  const immutablePayload = seoPersistenceProposalPayload(proposal)
  const immutablePayloadDigest = digestSeoProposalPayload(proposal)
  const common = {
    proposalId: proposal.proposalId,
    version: 1,
    idempotencyKey: `${proposal.proposalId}:v1:${immutablePayloadDigest.slice(0, 12)}`,
    payloadDigest: immutablePayloadDigest,
    semanticConflictKey: proposal.semanticConflictKey,
    lane: proposal.lane,
    targetType:
      proposal.lane === "engineering"
        ? ("Engineering" as const)
        : proposal.targetType === "watch"
          ? ("VideoLocale" as const)
          : ("ExperienceLocale" as const),
    targetId: proposal.targetId,
    canonicalUrl: proposal.canonicalUrl,
    locale: proposal.locale,
    canonicalIdentityDigest: proposal.canonicalIdentityDigest,
    baseContentHash: DigestSchema.safeParse(proposal.baseHash).success
      ? proposal.baseHash
      : null,
    intent: proposal.intent,
    expectedOutcome: proposal.expectedOutcome,
    risk: proposal.risk,
    verificationPlan: proposal.verificationPlan.join("\n"),
    evidence: proposal.evidenceObservationIds,
    caveats: proposal.caveats,
    payload: immutablePayload,
    expiresAt: addDays(now, 14),
  }
  if (proposal.lane === "editorial") {
    const editorialDiff = Object.fromEntries(
      proposal.fieldDiff.map((entry) => [
        entry.field,
        { before: entry.before, after: entry.after },
      ]),
    )
    return AdminProposalSchema.parse({
      ...common,
      editorialDiff,
      engineeringBrief: null,
      rollbackPlan:
        "Restore the retained pre-change snapshot through the normal Admin editorial flow.",
      affectedFields: proposal.fieldDiff.map((entry) => entry.field),
      preChangeSnapshot: proposal.preChangeSnapshot,
      treatmentSnapshot: {
        v: 1,
        data: {
          ...proposal.preChangeSnapshot.data,
          ...Object.fromEntries(
            proposal.fieldDiff.map((entry) => [entry.field, entry.after]),
          ),
        },
      },
    })
  }
  return AdminProposalSchema.parse({
    ...common,
    editorialDiff: null,
    engineeringBrief: {
      ...proposal.ticketBrief,
      ticketOnly: proposal.ticketOnly,
      deploymentProbe: proposal.deploymentProbe,
    },
    rollbackPlan: proposal.ticketOnly
      ? "Resolve through the linked engineering ticket; this proposal has no automated rollback path."
      : "Restore the pre-change production behavior through a separately reviewed rollback proposal.",
    affectedFields: proposal.ticketBrief.affectedScope,
    preChangeSnapshot: proposal.preChangeSnapshot,
    treatmentSnapshot: {
      canonicalUrl: proposal.canonicalUrl,
      deploymentProbe: proposal.deploymentProbe,
      ticketOnly: proposal.ticketOnly,
    },
  })
}

async function callAdminSeo<TResult>(input: {
  capability: SeoWorkloadCapability
  path: "/api/seo/ingest" | "/api/seo/evaluate" | "/api/seo/tickets"
  payload: unknown
  responseSchema: z.ZodType<TResult>
  config?: SeoConfig
  fetchImpl?: typeof fetch
  resolveHost?: Parameters<typeof validateSeoUrl>[1]["resolveHost"]
  sign?: typeof createSeoWorkloadAssertion
}): Promise<{ ok: true; result: TResult } | AdminSeoClientFailure> {
  const config = input.config ?? getSeoConfig()
  if (
    !config.admin.baseUrl ||
    !config.admin.keyId ||
    !config.admin.privateKey ||
    config.admin.allowedHosts.length === 0
  ) {
    return { ok: false, reason: "config_missing", retryable: false }
  }
  const safe = await validateSeoUrl(
    new URL(input.path, config.admin.baseUrl).toString(),
    {
      allowedHosts: config.admin.allowedHosts,
      resolveHost: input.resolveHost,
    },
  )
  if (!safe.ok) return { ok: false, reason: "not_allowed", retryable: false }
  const rawBody = JSON.stringify(input.payload)
  let assertion: string
  try {
    assertion = await (input.sign ?? createSeoWorkloadAssertion)({
      capability: input.capability,
      rawBody,
      config,
    })
  } catch {
    return { ok: false, reason: "config_missing", retryable: false }
  }
  let response: Response
  try {
    response = await (input.fetchImpl ?? fetch)(safe.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "forge-mastra-seo/1.0",
        "x-forge-seo-assertion": assertion,
      },
      body: rawBody,
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
      retryable: true,
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      ...classifySeoHttpStatus(response.status),
    }
  }
  const body = await readSeoJson(response, config.maxResponseBytes)
  const parsed = input.responseSchema.safeParse(body)
  return parsed.success
    ? { ok: true, result: parsed.data }
    : { ok: false, reason: "parse_error", retryable: true }
}

type ClientOptions = Pick<
  Parameters<typeof callAdminSeo>[0],
  "config" | "fetchImpl" | "resolveHost" | "sign"
>

export async function startSeoRun(
  payload: z.input<typeof StartRunRequestSchema>,
  options: ClientOptions = {},
) {
  const called = await callAdminSeo({
    capability: "ingest",
    path: "/api/seo/ingest",
    payload: StartRunRequestSchema.parse(payload),
    responseSchema: SuccessEnvelope(StartRunResultSchema),
    ...options,
  })
  if (!called.ok) return called
  const result = called.result.result
  const targets = result.targets.map((target) => {
    const data = target.preChangeSnapshot.data
    const title = typeof data.title === "string" ? data.title : null
    const descriptionValue = data.description ?? data.metaDescription
    const description =
      typeof descriptionValue === "string" ? descriptionValue : null
    const headings = Array.isArray(data.headings)
      ? data.headings.filter((item): item is string => typeof item === "string")
      : []
    return {
      targetId: target.targetId,
      targetType:
        target.targetType === "VideoLocale"
          ? ("watch" as const)
          : ("experience" as const),
      canonicalUrl: target.canonicalUrl,
      locale: target.locale,
      baseHash: target.baseContentHash,
      canonicalIdentityDigest: target.canonicalIdentityDigest,
      preChangeSnapshot: target.preChangeSnapshot,
      supportedFields: target.supportedFields,
      currentSnapshot: { title, description, headings },
    }
  })
  return {
    ok: true as const,
    result: {
      run: {
        id: result.runId,
        mode: result.mode.toLowerCase() as "off" | "dry_run" | "live",
        deduplicated: result.replayed,
        status: result.status,
        executionClaim: result.executionClaim,
      },
      targets,
      reviewedLessons: result.lessons,
    },
  }
}

export function completeSeoRun(
  payload: z.input<typeof CompleteRunRequestSchema>,
  options: ClientOptions = {},
) {
  return callAdminSeo({
    capability: "ingest",
    path: "/api/seo/ingest",
    payload: CompleteRunRequestSchema.parse(payload),
    responseSchema: SuccessEnvelope(RunRecordSchema),
    ...options,
  })
}

function matchedWindows(
  activatedAt: Date | null,
  stage: "activation" | "interim" | "final",
) {
  if (!activatedAt || stage === "activation") return null
  const days = stage === "interim" ? 7 : 28
  const baselineEnd = new Date(activatedAt)
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 1)
  const baselineStart = new Date(baselineEnd)
  baselineStart.setUTCDate(baselineStart.getUTCDate() - days + 1)
  const treatmentStart = new Date(activatedAt)
  const treatmentEnd = new Date(activatedAt)
  treatmentEnd.setUTCDate(treatmentEnd.getUTCDate() + days - 1)
  return {
    baseline: {
      startDate: dateOnly(baselineStart),
      endDate: dateOnly(baselineEnd),
    },
    treatment: {
      startDate: dateOnly(treatmentStart),
      endDate: dateOnly(treatmentEnd),
    },
  }
}

export async function claimDueSeoExperiments(
  payload: z.input<typeof ClaimDueRequestSchema>,
  options: ClientOptions = {},
) {
  const called = await callAdminSeo({
    capability: "evaluate",
    path: "/api/seo/evaluate",
    payload: ClaimDueRequestSchema.parse(payload),
    responseSchema: SuccessEnvelope(z.array(RawExperimentSchema).max(100)),
    ...options,
  })
  if (!called.ok) return called
  const config = options.config ?? getSeoConfig()
  const now = new Date()
  const experiments: SeoExperimentClaim[] = called.result.result.map((row) => {
    const stage =
      row.status === "AWAITING_ACTIVATION"
        ? ("activation" as const)
        : row.finalDueAt && row.finalDueAt <= now
          ? ("final" as const)
          : ("interim" as const)
    const windows = matchedWindows(row.activatedAt, stage)
    const payloadResult = z
      .object({
        deploymentProbe: z
          .object({
            type: z.enum([
              "page_text_hash",
              "structured_data_path",
              "response_header",
              "performance_budget",
            ]),
            canonicalUrl: z.string().url(),
            expectedValue: z.string(),
            canonicalizationVersion: z.string(),
            timeoutMs: z.number().int(),
            headerName: z.string().optional(),
          })
          .nullable()
          .optional(),
      })
      .passthrough()
      .safeParse(row.proposalVersion.payload)
    return {
      id: row.id,
      claimGeneration: row.claimGeneration,
      claimToken: row.claimToken,
      stage,
      status: row.status,
      lane:
        row.proposalVersion.proposal.lane === "ENGINEERING"
          ? "engineering"
          : "editorial",
      canonicalUrl: row.proposalVersion.proposal.canonicalUrl,
      treatmentHash: row.treatmentHash,
      expectedActivationHash: row.expectedActivationHash,
      currentCanonicalActivationHash: row.currentCanonicalActivationHash,
      preChangeHash: row.preChangeHash,
      preChangeSnapshot: row.preChangeSnapshot,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      gscPropertyId: config.gscPropertyIds[0] ?? null,
      ga4PropertyId: config.ga4PropertyIds[0] ?? null,
      baselineWindow: windows?.baseline ?? null,
      treatmentWindow: windows?.treatment ?? null,
      confounders: Array.isArray(row.confounders)
        ? row.confounders.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      deploymentProbe: payloadResult.success
        ? (payloadResult.data.deploymentProbe ?? null)
        : null,
    }
  })
  return { ok: true as const, result: { experiments } }
}

export function recordSeoEvaluation(
  payload: z.input<typeof RecordEvaluationRequestSchema>,
  options: ClientOptions = {},
) {
  return callAdminSeo({
    capability: "evaluate",
    path: "/api/seo/evaluate",
    payload: RecordEvaluationRequestSchema.parse(payload),
    responseSchema: SuccessEnvelope(
      z
        .object({
          eventId: BoundedIdSchema,
          experimentId: BoundedIdSchema,
          outcome: z.string(),
        })
        .strict(),
    ),
    ...options,
  })
}

export async function claimSeoTickets(
  payload: z.input<typeof ClaimTicketsRequestSchema>,
  options: ClientOptions = {},
) {
  const called = await callAdminSeo({
    capability: "tickets",
    path: "/api/seo/tickets",
    payload: ClaimTicketsRequestSchema.parse(payload),
    responseSchema: SuccessEnvelope(TicketClaimResultSchema.nullable()),
    ...options,
  })
  if (!called.ok) return called
  return {
    ok: true as const,
    result: { entries: called.result.result ? [called.result.result] : [] },
  }
}

export function updateSeoTicket(
  payload: z.input<
    | typeof CompleteTicketRequestSchema
    | typeof RetryTicketRequestSchema
    | typeof ManualTicketRequestSchema
  >,
  options: ClientOptions = {},
) {
  const parsed = SeoTicketsRequestSchema.parse(payload)
  if (parsed.action === "claim")
    throw new Error("Ticket update action required")
  return callAdminSeo({
    capability: "tickets",
    path: "/api/seo/tickets",
    payload: parsed,
    responseSchema: SuccessEnvelope(z.unknown()),
    ...options,
  })
}

export type SeoRunStartResult = Awaited<ReturnType<typeof startSeoRun>>
export type SeoRunCompleteResult = Awaited<ReturnType<typeof completeSeoRun>>
export type SeoEvaluationClaimResult = Awaited<
  ReturnType<typeof claimDueSeoExperiments>
>
export type SeoTicketClaimResult = Awaited<ReturnType<typeof claimSeoTickets>>
