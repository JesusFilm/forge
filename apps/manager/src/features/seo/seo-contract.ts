import { z } from "zod"

export const SEO_WORKSPACE_VIEWS = [
  "overview",
  "proposals",
  "experiments",
  "learnings",
  "reconciliation",
] as const

export type SeoWorkspaceView = (typeof SEO_WORKSPACE_VIEWS)[number]

export type SeoEvidenceProvider =
  | "GSC"
  | "GA4"
  | "FIRECRAWL"
  | "PAGE"
  | "GROUNDED_SEARCH"
  | "UNKNOWN"

export type SeoEvidenceObservation = {
  id: string
  provider: SeoEvidenceProvider
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "INSUFFICIENT"
  summary: string
  retrievedAt?: string
  sourceUrl?: string
  quality?: string
  coverage?: string
}

export type SeoEditorialDiff = {
  field: string
  before: string
  after: string
}

export type SeoDeploymentProbe = {
  kind: string
  target: string
  expected: string
  canonicalizationVersion?: string
}

export type SeoEngineeringBrief = {
  title: string
  problem: string
  acceptanceCriteria: string[]
  deploymentProbe?: SeoDeploymentProbe
  ticketOnly: boolean
}

export type SeoDecision = {
  status?: string
  actor?: string
  decidedAt?: string
  reason?: string
}

export type SeoMaterialization = {
  status?: string
  draftRevisionId?: string
  editorPath?: string
  ticketOutboxId?: string
  remoteId?: string
  remoteUrl?: string
}

export type SeoProposal = {
  id: string
  version: number
  payloadDigest: string
  status: string
  lane: string
  targetType: string
  targetId: string | null
  canonicalUrl: string
  locale: string
  intent: string
  expectedOutcome: string
  risk: string
  verificationPlan: string
  rollbackPlan: string
  editorialDiff: SeoEditorialDiff[]
  engineeringBrief: SeoEngineeringBrief | null
  evidence: SeoEvidenceObservation[]
  caveats: string[]
  overlapCount: number
  expiresAt?: string
  createdAt: string
  decision: SeoDecision | null
  materialization: SeoMaterialization | null
}

export type SeoEvaluation = {
  id: string
  kind: string
  outcome?: string
  metrics: Record<string, unknown>
  evidenceDigest: string
  confounders: string[]
  observedAt: string
}

export type SeoExperiment = {
  id: string
  proposalId: string
  proposalVersion: number
  status: string
  canonicalUrl: string
  locale: string
  lane: string
  activatedAt?: string
  observedActivationHash?: string
  measurementStartsAt?: string
  interimDueAt?: string
  finalDueAt?: string
  confounders: string[]
  evaluations: SeoEvaluation[]
}

export type SeoLesson = {
  id: string
  experimentId: string
  proposalId: string
  proposalVersion: number
  status: string
  content: string
  evidenceDigest: string
  metrics: Record<string, unknown>
  confounders: string[]
  reviewedById?: string
  reviewedAt?: string
  createdAt: string
}

export type SeoTicketAttempt = {
  id: string
  status: string
  attemptedAt?: string
  errorCode?: string
}

export type SeoCandidateTicket = {
  remoteId: string
  remoteUrl: string
  title: string
  team?: string
  payloadDigest?: string
}

export type SeoTicketReconciliation = {
  outboxId: string
  proposalId: string
  proposalVersion: number
  status: string
  payloadDigest: string
  marker: string
  attemptCount: number
  lastErrorCode?: string
  remoteId?: string
  remoteUrl?: string
  attempts: SeoTicketAttempt[]
  candidateTickets: SeoCandidateTicket[]
}

export type SeoWorkspace = {
  generatedAt: string
  proposals: SeoProposal[]
  experiments: SeoExperiment[]
  lessons: SeoLesson[]
  ticketReconciliations: SeoTicketReconciliation[]
}

export type SeoProposalDecisionResult = {
  status:
    | "APPROVED"
    | "REJECTED"
    | "STALE"
    | "CONFLICT"
    | "ALREADY_DECIDED"
    | "EXPIRED"
  proposalId: string
  version: number
  decisionId?: string
  draftRevisionId?: string
  editorPath?: string
  ticketOutboxId?: string
  message?: string
}

const boundedString = (max: number) => z.string().max(max)
const optionalNullableString = (max: number) =>
  boundedString(max)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined)

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
  fallback = "",
  max = 10_000,
): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") return value.slice(0, max)
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).slice(0, max)
    }
  }
  return fallback
}

function readStringList(value: unknown, maxItems = 30): string[] {
  if (typeof value === "string") return [value.slice(0, 2_000)]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, maxItems)
    .map((item) => item.slice(0, 2_000))
}

function normalizeProvider(value: string): SeoEvidenceProvider {
  const provider = value.trim().toUpperCase().replaceAll("-", "_")
  if (provider.includes("SEARCH_CONSOLE") || provider === "GSC") return "GSC"
  if (provider.includes("ANALYTICS") || provider === "GA4") return "GA4"
  if (provider.includes("FIRECRAWL")) return "FIRECRAWL"
  if (provider === "PAGE" || provider.includes("DIRECT")) return "PAGE"
  if (provider.includes("GROUNDED") || provider.includes("WEB_SEARCH")) {
    return "GROUNDED_SEARCH"
  }
  return "UNKNOWN"
}

function normalizeEvidenceStatus(
  value: string,
): SeoEvidenceObservation["status"] {
  const status = value.trim().toUpperCase()
  if (status === "AVAILABLE" || status === "SUCCESS" || status === "OK") {
    return "AVAILABLE"
  }
  if (status === "PARTIAL") return "PARTIAL"
  if (status === "INSUFFICIENT" || status === "INSUFFICIENT_DATA") {
    return "INSUFFICIENT"
  }
  return "UNAVAILABLE"
}

export function parseSeoEvidence(value: unknown): SeoEvidenceObservation[] {
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value).observations)
      ? (asRecord(value).observations as unknown[])
      : []

  return candidates.slice(0, 40).map((candidate, index) => {
    const record = asRecord(candidate)
    return {
      id: readString(record, ["id", "observationId"], `evidence-${index}`),
      provider: normalizeProvider(
        readString(record, ["provider", "source", "kind"], "unknown"),
      ),
      status: normalizeEvidenceStatus(
        readString(record, ["status", "availability"], "unavailable"),
      ),
      summary: readString(
        record,
        ["summary", "observation", "message"],
        "No bounded summary was retained.",
      ),
      retrievedAt:
        readString(record, ["retrievedAt", "observedAt"]) || undefined,
      sourceUrl:
        readString(record, ["sourceUrl", "url"], "", 2_048) || undefined,
      quality: readString(record, ["quality", "dataState"]) || undefined,
      coverage: readString(record, ["coverage", "caveat"]) || undefined,
    }
  })
}

export function parseEditorialDiff(value: unknown): SeoEditorialDiff[] {
  const record = asRecord(value)
  const source = Array.isArray(value)
    ? value.map((candidate, index) => [undefined, candidate, index] as const)
    : Array.isArray(record.fields)
      ? (record.fields as unknown[]).map(
          (candidate, index) => [undefined, candidate, index] as const,
        )
      : Object.entries(record)
          .filter(([field]) => field !== "fields")
          .map(
            ([field, candidate], index) => [field, candidate, index] as const,
          )

  return source.slice(0, 30).map(([field, candidate, index]) => {
    const record = asRecord(candidate)
    return {
      field:
        field ??
        readString(record, ["field", "path", "name"], `field-${index}`),
      before: readString(record, ["before", "current", "from"], "Not set"),
      after: readString(record, ["after", "proposed", "to"], "Not set"),
    }
  })
}

export function parseEngineeringBrief(
  value: unknown,
): SeoEngineeringBrief | null {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return null
  const probe = asRecord(record.deploymentProbe ?? record.probe)
  const hasProbe = Object.keys(probe).length > 0
  return {
    title: readString(record, ["title", "summary"], "Engineering SEO brief"),
    problem: readString(record, ["problem", "description", "body"]),
    acceptanceCriteria: readStringList(
      record.acceptanceCriteria ?? record.acceptance_criteria,
    ),
    deploymentProbe: hasProbe
      ? {
          kind: readString(probe, ["kind", "type"]),
          target: readString(probe, ["target", "url", "path"], "", 2_048),
          expected: readString(probe, ["expected", "expectedValue", "hash"]),
          canonicalizationVersion:
            readString(probe, ["canonicalizationVersion", "version"]) ||
            undefined,
        }
      : undefined,
    ticketOnly:
      record.ticketOnly === true || record.ticket_only === true || !hasProbe,
  }
}

function parseDecision(value: unknown): SeoDecision | null {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return null
  return {
    status: readString(record, ["status", "action"]) || undefined,
    actor: readString(record, ["actor", "actorId", "decidedBy"]) || undefined,
    decidedAt: readString(record, ["decidedAt", "createdAt"]) || undefined,
    reason: readString(record, ["reason"]) || undefined,
  }
}

function parseMaterialization(value: unknown): SeoMaterialization | null {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return null
  return {
    status: readString(record, ["status"]) || undefined,
    draftRevisionId: readString(record, ["draftRevisionId"]) || undefined,
    editorPath: readString(record, ["editorPath"]) || undefined,
    ticketOutboxId:
      readString(record, ["ticketOutboxId", "outboxId"]) || undefined,
    remoteId: readString(record, ["remoteId"]) || undefined,
    remoteUrl: readString(record, ["remoteUrl"], "", 2_048) || undefined,
  }
}

const rawProposalSchema = z.object({
  id: boundedString(200),
  version: z.number().int().positive(),
  payloadDigest: boundedString(256),
  status: boundedString(80),
  lane: boundedString(80),
  targetType: boundedString(120),
  targetId: boundedString(300).nullable(),
  canonicalUrl: boundedString(2_048),
  locale: boundedString(100),
  intent: boundedString(10_000),
  expectedOutcome: boundedString(10_000),
  risk: boundedString(10_000),
  verificationPlan: boundedString(10_000),
  rollbackPlan: boundedString(10_000),
  editorialDiff: z.unknown().nullable().optional(),
  engineeringBrief: z.unknown().nullable().optional(),
  evidence: z.unknown().nullable().optional(),
  caveats: z.unknown().nullable().optional(),
  overlapCount: z.number().int().nonnegative().default(0),
  expiresAt: optionalNullableString(100),
  createdAt: boundedString(100),
  decision: z.unknown().nullable().optional(),
  materialization: z.unknown().nullable().optional(),
})

export const seoProposalSchema: z.ZodType<SeoProposal> =
  rawProposalSchema.transform((proposal) => ({
    ...proposal,
    editorialDiff: parseEditorialDiff(proposal.editorialDiff),
    engineeringBrief: parseEngineeringBrief(proposal.engineeringBrief),
    evidence: parseSeoEvidence(proposal.evidence),
    caveats: readStringList(proposal.caveats),
    decision: parseDecision(proposal.decision),
    materialization: parseMaterialization(proposal.materialization),
  }))

const rawEvaluationSchema = z.object({
  id: boundedString(200),
  kind: boundedString(80),
  outcome: optionalNullableString(80),
  metrics: z.record(z.string(), z.unknown()).default({}),
  evidenceDigest: boundedString(256),
  confounders: z.unknown().nullable().optional(),
  observedAt: boundedString(100),
})

const seoEvaluationSchema: z.ZodType<SeoEvaluation> =
  rawEvaluationSchema.transform((evaluation) => ({
    ...evaluation,
    confounders: readStringList(evaluation.confounders),
  }))

const rawExperimentSchema = z.object({
  id: boundedString(200),
  proposalId: boundedString(200),
  proposalVersion: z.number().int().positive(),
  status: boundedString(80),
  canonicalUrl: boundedString(2_048),
  locale: boundedString(100),
  lane: boundedString(80),
  activatedAt: optionalNullableString(100),
  observedActivationHash: optionalNullableString(256),
  measurementStartsAt: optionalNullableString(100),
  interimDueAt: optionalNullableString(100),
  finalDueAt: optionalNullableString(100),
  confounders: z.unknown().nullable().optional(),
  evaluations: z.array(seoEvaluationSchema).max(100).default([]),
})

export const seoExperimentSchema: z.ZodType<SeoExperiment> =
  rawExperimentSchema.transform((experiment) => ({
    ...experiment,
    confounders: readStringList(experiment.confounders),
  }))

const rawLessonSchema = z.object({
  id: boundedString(200),
  experimentId: boundedString(200),
  proposalId: boundedString(200),
  proposalVersion: z.number().int().positive(),
  status: boundedString(80),
  content: boundedString(20_000),
  evidenceDigest: boundedString(256),
  metrics: z.record(z.string(), z.unknown()).default({}),
  confounders: z.unknown().nullable().optional(),
  reviewedById: optionalNullableString(200),
  reviewedAt: optionalNullableString(100),
  createdAt: boundedString(100),
})

export const seoLessonSchema: z.ZodType<SeoLesson> = rawLessonSchema.transform(
  (lesson) => ({
    ...lesson,
    confounders: readStringList(lesson.confounders),
  }),
)

function parseAttempts(value: unknown): SeoTicketAttempt[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map((candidate, index) => {
    const record = asRecord(candidate)
    return {
      id: readString(record, ["id"], `attempt-${index}`),
      status: readString(record, ["status"], "UNKNOWN"),
      attemptedAt:
        readString(record, ["attemptedAt", "createdAt"]) || undefined,
      errorCode: readString(record, ["errorCode", "reason"]) || undefined,
    }
  })
}

function parseCandidateTickets(value: unknown): SeoCandidateTicket[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap((candidate) => {
    const record = asRecord(candidate)
    const remoteId = readString(record, ["remoteId", "id"])
    const remoteUrl = readString(record, ["remoteUrl", "url"], "", 2_048)
    if (!remoteId || !remoteUrl) return []
    return [
      {
        remoteId,
        remoteUrl,
        title: readString(record, ["title", "summary"], remoteId),
        team: readString(record, ["team", "teamName"]) || undefined,
        payloadDigest: readString(record, ["payloadDigest"]) || undefined,
      },
    ]
  })
}

const rawReconciliationSchema = z.object({
  outboxId: boundedString(200),
  proposalId: boundedString(200),
  proposalVersion: z.number().int().positive(),
  status: boundedString(80),
  payloadDigest: boundedString(256),
  marker: boundedString(500),
  attemptCount: z.number().int().nonnegative(),
  lastErrorCode: optionalNullableString(200),
  remoteId: optionalNullableString(200),
  remoteUrl: optionalNullableString(2_048),
  attempts: z.unknown().nullable().optional(),
  candidateTickets: z.unknown().nullable().optional(),
})

export const seoTicketReconciliationSchema: z.ZodType<SeoTicketReconciliation> =
  rawReconciliationSchema.transform((reconciliation) => ({
    ...reconciliation,
    attempts: parseAttempts(reconciliation.attempts),
    candidateTickets: parseCandidateTickets(reconciliation.candidateTickets),
  }))

export const seoWorkspaceSchema: z.ZodType<SeoWorkspace> = z.object({
  generatedAt: boundedString(100),
  proposals: z.array(seoProposalSchema).max(50),
  experiments: z.array(seoExperimentSchema).max(100),
  lessons: z.array(seoLessonSchema).max(100),
  ticketReconciliations: z.array(seoTicketReconciliationSchema).max(100),
})

export const seoProposalDecisionResultSchema: z.ZodType<SeoProposalDecisionResult> =
  z.object({
    status: z.enum([
      "APPROVED",
      "REJECTED",
      "STALE",
      "CONFLICT",
      "ALREADY_DECIDED",
      "EXPIRED",
    ]),
    proposalId: boundedString(200),
    version: z.number().int().positive(),
    decisionId: optionalNullableString(200),
    draftRevisionId: optionalNullableString(200),
    editorPath: optionalNullableString(2_048),
    ticketOutboxId: optionalNullableString(200),
    message: optionalNullableString(2_000),
  })

export const seoWorkspaceViewSchema = z.enum(SEO_WORKSPACE_VIEWS)

export function isSafeExternalUrl(value?: string): value is string {
  if (!value) return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

export function buildSeoDemoWorkspace(): SeoWorkspace {
  return seoWorkspaceSchema.parse({
    generatedAt: "2026-08-01T09:42:00.000Z",
    proposals: [
      {
        id: "seo-proposal-rollback-es",
        version: 2,
        payloadDigest: "sha256:rollback-treatment-v2",
        status: "PROPOSED",
        lane: "ROLLBACK",
        targetType: "WATCH_VIDEO_LOCALE",
        targetId: "video-jesus-es",
        canonicalUrl:
          "https://www.jesusfilm.org/watch/jesus.html/spanish-latin-america.html",
        locale: "es-419",
        intent: "Restore the pre-change promise after a search regression.",
        expectedOutcome:
          "Recover qualified clicks without weakening mission engagement.",
        risk: "High — the activated treatment is below the registered search guardrail.",
        verificationPlan:
          "Publish the reviewed Admin draft, then wait for the live page_text_hash probe to match.",
        rollbackPlan:
          "This proposal is itself the approval-required rollback to the immutable pre-change snapshot.",
        editorialDiff: [
          {
            field: "title",
            before: "Watch JESUS — A Story of Hope",
            after: "Watch the JESUS Film in Spanish",
          },
        ],
        engineeringBrief: null,
        evidence: [
          {
            id: "gsc-rollback-1",
            provider: "GSC",
            status: "AVAILABLE",
            summary:
              "Final matched window: clicks −18.4%, impressions comparable, CTR below the registered −10% threshold.",
            retrievedAt: "2026-08-01T08:58:00.000Z",
            quality: "final",
            coverage:
              "Canonical page and locale; query rows are top-row coverage, not a complete query census.",
          },
          {
            id: "ga4-rollback-1",
            provider: "GA4",
            status: "AVAILABLE",
            summary: "Mission starts remained within the 15% guardrail.",
            retrievedAt: "2026-08-01T09:01:00.000Z",
          },
        ],
        caveats: [
          "A Spanish-language campaign overlapped three days of the final window.",
        ],
        overlapCount: 0,
        expiresAt: "2026-08-12T09:42:00.000Z",
        createdAt: "2026-08-01T09:11:00.000Z",
        decision: null,
        materialization: null,
      },
      {
        id: "seo-proposal-watch-en",
        version: 1,
        payloadDigest: "sha256:watch-en-title-v1",
        status: "PROPOSED",
        lane: "EDITORIAL",
        targetType: "WATCH_VIDEO_LOCALE",
        targetId: "video-jesus-en",
        canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html",
        locale: "en",
        intent:
          "Help seekers looking for a full, free film about Jesus recognize the page before clicking.",
        expectedOutcome:
          "Increase qualified organic CTR while preserving watch starts.",
        risk: "Medium — title changes can shift query mix.",
        verificationPlan:
          "After Admin publication, require the canonical page_text_hash to match; compare final 28-day GSC windows with at least 200 impressions each.",
        rollbackPlan:
          "Restore the immutable title, description, and H1 snapshot through a new reviewed proposal.",
        editorialDiff: [
          {
            field: "searchTitle",
            before: "JESUS",
            after: "Watch JESUS — Full Movie About the Life of Jesus",
          },
          {
            field: "description",
            before: "Watch JESUS online.",
            after:
              "Watch the full JESUS film free online and explore the life, teachings, death, and resurrection of Jesus Christ.",
          },
          {
            field: "heading",
            before: "JESUS",
            after: "Watch the JESUS Film",
          },
        ],
        engineeringBrief: null,
        evidence: [
          {
            id: "gsc-watch-en-1",
            provider: "GSC",
            status: "AVAILABLE",
            summary:
              "2,840 final impressions and 1.7% CTR for full-film intent; row absence remains unobserved, never zero.",
            retrievedAt: "2026-08-01T08:56:00.000Z",
            quality: "final",
            coverage:
              "URL-prefix property, page/query/device dimensions, Pacific-time window.",
          },
          {
            id: "ga4-watch-en-1",
            provider: "GA4",
            status: "PARTIAL",
            summary:
              "Landing-page engagement available; mission outcome thresholding applies.",
            retrievedAt: "2026-08-01T09:02:00.000Z",
            coverage:
              "Canonical landing-page/date aggregate only; no query-to-user join.",
          },
          {
            id: "page-watch-en-1",
            provider: "FIRECRAWL",
            status: "AVAILABLE",
            summary:
              "Live fetch confirmed current title, description, H1, canonical, and indexable response.",
            retrievedAt: "2026-08-01T09:04:00.000Z",
            sourceUrl: "https://www.jesusfilm.org/watch/jesus.html",
          },
          {
            id: "grounded-watch-en-1",
            provider: "GROUNDED_SEARCH",
            status: "UNAVAILABLE",
            summary:
              "Grounded observation quota was unavailable; no recommendation claim depends on it.",
            retrievedAt: "2026-08-01T09:05:00.000Z",
          },
        ],
        caveats: [
          "GSC returns top rows, not every query row.",
          "The final verdict must come from GSC, not page-state evidence.",
        ],
        overlapCount: 1,
        expiresAt: "2026-08-14T09:42:00.000Z",
        createdAt: "2026-08-01T09:12:00.000Z",
        decision: null,
        materialization: null,
      },
      {
        id: "seo-proposal-structured-data",
        version: 1,
        payloadDigest: "sha256:video-jsonld-v1",
        status: "BLOCKED",
        lane: "ENGINEERING",
        targetType: "WATCH_TEMPLATE",
        targetId: "watch-video-jsonld",
        canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html",
        locale: "en",
        intent:
          "Keep VideoObject duration and transcript metadata aligned with the rendered page.",
        expectedOutcome: "Reduce structured-data drift on Watch canonicals.",
        risk: "Medium — shared template blast radius requires explicit overlap review.",
        verificationPlan:
          "Server probe structured_data_path $.duration and $.transcript against the approved expected values.",
        rollbackPlan:
          "Revert the implementation PR after the probe reports a mismatch; no automated deployment or rollback.",
        editorialDiff: [],
        engineeringBrief: {
          title: "Align Watch VideoObject with rendered media metadata",
          problem:
            "The rendered page and VideoObject can disagree on duration and transcript availability.",
          acceptanceCriteria: [
            "Emit duration from the selected playable variant.",
            "Emit transcript only when the canonical locale has retained transcript text.",
            "Keep contextual Watch routes out of the experiment identity.",
          ],
          deploymentProbe: {
            kind: "structured_data_path",
            target: "https://www.jesusfilm.org/watch/jesus.html",
            expected: "$.duration and $.transcript match approved snapshot",
            canonicalizationVersion: "watch-jsonld-v2",
          },
          ticketOnly: false,
        },
        evidence: [
          {
            id: "page-jsonld-1",
            provider: "PAGE",
            status: "AVAILABLE",
            summary:
              "Direct production fetch observed a duration mismatch. This is page-state evidence, not Google indexing proof.",
            retrievedAt: "2026-08-01T09:06:00.000Z",
          },
          {
            id: "gsc-jsonld-1",
            provider: "GSC",
            status: "INSUFFICIENT",
            summary:
              "No comparable search-performance slice supports an outcome claim yet.",
            retrievedAt: "2026-08-01T09:06:00.000Z",
          },
        ],
        caveats: ["Blocked until the shared template overlap is acknowledged."],
        overlapCount: 2,
        expiresAt: "2026-08-14T09:42:00.000Z",
        createdAt: "2026-08-01T09:13:00.000Z",
        decision: null,
        materialization: null,
      },
    ],
    experiments: [
      {
        id: "seo-experiment-es-rollback",
        proposalId: "seo-proposal-original-es",
        proposalVersion: 1,
        status: "HARMFUL",
        canonicalUrl:
          "https://www.jesusfilm.org/watch/jesus.html/spanish-latin-america.html",
        locale: "es-419",
        lane: "EDITORIAL",
        activatedAt: "2026-06-26T14:03:00.000Z",
        observedActivationHash: "sha256:es-treatment",
        measurementStartsAt: "2026-06-26T14:03:00.000Z",
        interimDueAt: "2026-07-03T14:03:00.000Z",
        finalDueAt: "2026-07-24T14:03:00.000Z",
        confounders: ["Spanish campaign overlap: July 4–6"],
        evaluations: [
          {
            id: "eval-es-interim",
            kind: "INTERIM",
            outcome: "MONITOR",
            metrics: { gscCtrDelta: -0.07, impressions: 612 },
            evidenceDigest: "sha256:es-interim-evidence",
            confounders: [],
            observedAt: "2026-07-04T02:31:00.000Z",
          },
          {
            id: "eval-es-final",
            kind: "FINAL",
            outcome: "HARMFUL",
            metrics: {
              gscCtrDelta: -0.184,
              ga4MissionDelta: -0.02,
              impressions: 2490,
            },
            evidenceDigest: "sha256:es-final-evidence",
            confounders: ["Spanish campaign overlap: July 4–6"],
            observedAt: "2026-07-25T02:31:00.000Z",
          },
        ],
      },
      {
        id: "seo-experiment-fr",
        proposalId: "seo-proposal-fr",
        proposalVersion: 1,
        status: "INSUFFICIENT_DATA",
        canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html/french.html",
        locale: "fr",
        lane: "EDITORIAL",
        activatedAt: "2026-07-02T08:00:00.000Z",
        observedActivationHash: "sha256:fr-treatment",
        measurementStartsAt: "2026-07-02T08:00:00.000Z",
        interimDueAt: "2026-07-09T08:00:00.000Z",
        finalDueAt: "2026-07-30T08:00:00.000Z",
        confounders: [],
        evaluations: [
          {
            id: "eval-fr-final",
            kind: "FINAL",
            outcome: "INSUFFICIENT_DATA",
            metrics: {
              baselineImpressions: 124,
              treatmentImpressions: 158,
              minimum: 200,
            },
            evidenceDigest: "sha256:fr-final-evidence",
            confounders: [],
            observedAt: "2026-07-31T02:31:00.000Z",
          },
        ],
      },
    ],
    lessons: [
      {
        id: "seo-lesson-es",
        experimentId: "seo-experiment-es-rollback",
        proposalId: "seo-proposal-original-es",
        proposalVersion: 1,
        status: "PENDING",
        content:
          "Specific language-and-format promises should remain explicit when a page already ranks for full-film intent.",
        evidenceDigest: "sha256:es-final-evidence",
        metrics: {
          gscCtrDelta: -0.184,
          ga4MissionDelta: -0.02,
          impressions: 2490,
        },
        confounders: ["Spanish campaign overlap: July 4–6"],
        reviewedById: null,
        reviewedAt: null,
        createdAt: "2026-07-25T02:35:00.000Z",
      },
      {
        id: "seo-lesson-active-en",
        experimentId: "seo-experiment-en-2026-05",
        proposalId: "seo-proposal-en-2026-05",
        proposalVersion: 1,
        status: "ACTIVE",
        content:
          "Lead English Watch titles with the viewing action and stable film identity; avoid unmeasured superlatives.",
        evidenceDigest: "sha256:en-final-evidence",
        metrics: { gscCtrDelta: 0.143, impressions: 5270 },
        confounders: [],
        reviewedById: "manager-user-4",
        reviewedAt: "2026-06-28T15:20:00.000Z",
        createdAt: "2026-06-28T02:35:00.000Z",
      },
    ],
    ticketReconciliations: [
      {
        outboxId: "seo-outbox-jsonld",
        proposalId: "seo-proposal-structured-data-prior",
        proposalVersion: 1,
        status: "MANUAL_RECONCILE",
        payloadDigest: "sha256:linear-watch-jsonld",
        marker: "[seo:proposal-structured-data-prior:v1]",
        attemptCount: 2,
        lastErrorCode: "REMOTE_SUCCESS_AMBIGUOUS",
        remoteId: null,
        remoteUrl: null,
        attempts: [
          {
            id: "attempt-1",
            status: "TIMEOUT",
            attemptedAt: "2026-08-01T08:10:00.000Z",
            errorCode: "REMOTE_SUCCESS_UNKNOWN",
          },
          {
            id: "attempt-2",
            status: "RECONCILE_INCONCLUSIVE",
            attemptedAt: "2026-08-01T08:20:00.000Z",
            errorCode: "MULTIPLE_CANDIDATES",
          },
        ],
        candidateTickets: [
          {
            remoteId: "FGE-401",
            remoteUrl: "https://linear.app/jesus-film-project/issue/FGE-401",
            title: "Align Watch VideoObject with rendered media metadata",
            team: "Forge",
            payloadDigest: "sha256:linear-watch-jsonld",
          },
          {
            remoteId: "FGE-398",
            remoteUrl: "https://linear.app/jesus-film-project/issue/FGE-398",
            title: "Investigate Watch structured data",
            team: "Forge",
            payloadDigest: "sha256:different-payload",
          },
        ],
      },
    ],
  })
}
