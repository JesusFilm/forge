import { z } from "zod"

export const supportSurfaceSchema = z.enum([
  "watch_page",
  "catalog_discovery",
  "playback",
  "language_selection",
  "sharing",
  "downloads",
  "other_public_watch",
])

export const feedbackKindSchema = z.enum(["bug", "usability", "need", "other"])

export const validationStateSchema = z.enum([
  "not_attempted",
  "confirmed",
  "unverified",
  "blocked",
])

export const sanitizedSupportConversationSchema = z.object({
  sourceId: z.string().min(1).max(128),
  mailboxId: z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
  sourceUrl: z.string().url().max(2_048).optional(),
  subject: z.string().max(300),
  excerpt: z.string().max(12_000),
  watchUrls: z.array(z.string().url().max(2_048)).max(20),
  redactionCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export type SanitizedSupportConversation = z.infer<
  typeof sanitizedSupportConversationSchema
>

export const supportObservationAnalysisSchema = z.object({
  relevant: z.boolean(),
  kind: feedbackKindSchema,
  surface: supportSurfaceSchema,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1_000),
  reportedEvidence: z.array(z.string().min(1).max(500)).max(5),
  expectedBehavior: z.string().max(500).optional(),
  actualBehavior: z.string().max(500).optional(),
  themeKey: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  confidence: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  validationRecommended: z.boolean(),
  inference: z.string().max(500),
})

export type SupportObservationAnalysis = z.infer<
  typeof supportObservationAnalysisSchema
>

export const watchValidationEvidenceSchema = z.object({
  state: validationStateSchema,
  incomingUrl: z.string().url().max(2_048).optional(),
  status: z.number().int().min(100).max(599).optional(),
  finalUrl: z.string().url().max(2_048).optional(),
  evidence: z.array(z.string().min(1).max(300)).max(5),
  missingProof: z.string().max(500).optional(),
  errorCode: z.string().max(80).optional(),
})

export type WatchValidationEvidence = z.infer<
  typeof watchValidationEvidenceSchema
>

export const storedSupportObservationSchema = z.object({
  source: sanitizedSupportConversationSchema,
  analysis: supportObservationAnalysisSchema,
  validation: watchValidationEvidenceSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  analyzedAt: z.string().datetime({ offset: true }),
})

export type StoredSupportObservation = z.infer<
  typeof storedSupportObservationSchema
>

export const actionTypeSchema = z.enum([
  "confirmed_bug",
  "needs_validation",
  "ux_improvement",
  "daily_summary",
])

export type SupportActionType = z.infer<typeof actionTypeSchema>

export const supportActionDraftSchema = z.object({
  idempotencyKey: z.string().min(1).max(180),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  type: actionTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(12_000),
  labelId: z.string().min(1).optional(),
  sourceIds: z.array(z.string().min(1).max(128)).min(1).max(50),
})

export type SupportActionDraft = z.infer<typeof supportActionDraftSchema>

export const supportRunStatusSchema = z.enum([
  "running",
  "complete",
  "partial",
  "disabled",
  "failed",
  "already_running",
])

export const supportRunCountersSchema = z.object({
  fetched: z.number().int().nonnegative().default(0),
  pages: z.number().int().nonnegative().default(0),
  sanitized: z.number().int().nonnegative().default(0),
  duplicates: z.number().int().nonnegative().default(0),
  relevant: z.number().int().nonnegative().default(0),
  bugs: z.number().int().nonnegative().default(0),
  usability: z.number().int().nonnegative().default(0),
  needs: z.number().int().nonnegative().default(0),
  other: z.number().int().nonnegative().default(0),
  validated: z.number().int().nonnegative().default(0),
  validationConfirmed: z.number().int().nonnegative().default(0),
  validationUnverified: z.number().int().nonnegative().default(0),
  validationBlocked: z.number().int().nonnegative().default(0),
  clusters: z.number().int().nonnegative().default(0),
  reportOnly: z.number().int().nonnegative().default(0),
  actionsPlanned: z.number().int().nonnegative().default(0),
  actionsCreated: z.number().int().nonnegative().default(0),
  actionsDeduplicated: z.number().int().nonnegative().default(0),
  actionsDeferred: z.number().int().nonnegative().default(0),
  capped: z.number().int().nonnegative().default(0),
  failures: z.number().int().nonnegative().default(0),
  redactions: z.number().int().nonnegative().default(0),
})

export type SupportRunCounters = z.infer<typeof supportRunCountersSchema>

export const supportRunReportSchema = z.object({
  runKey: z.string().min(1).max(180),
  status: supportRunStatusSchema,
  dryRun: z.boolean(),
  cutoff: z.string().datetime({ offset: true }),
  cursorStart: z.string().datetime({ offset: true }),
  cursorEnd: z.string().datetime({ offset: true }),
  counters: supportRunCountersSchema,
  findings: z
    .array(
      z.object({
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        title: z.string().max(160),
        kind: feedbackKindSchema,
        validation: validationStateSchema,
        sourceCount: z.number().int().positive(),
      }),
    )
    .max(200),
  actionUrls: z.array(z.string().url().max(2_048)).max(25),
  errors: z.array(z.string().max(300)).max(50),
  partialReason: z.string().max(300).optional(),
})

export type SupportRunReport = z.infer<typeof supportRunReportSchema>

export const emptySupportRunCounters = (): SupportRunCounters => ({
  fetched: 0,
  pages: 0,
  sanitized: 0,
  duplicates: 0,
  relevant: 0,
  bugs: 0,
  usability: 0,
  needs: 0,
  other: 0,
  validated: 0,
  validationConfirmed: 0,
  validationUnverified: 0,
  validationBlocked: 0,
  clusters: 0,
  reportOnly: 0,
  actionsPlanned: 0,
  actionsCreated: 0,
  actionsDeduplicated: 0,
  actionsDeferred: 0,
  capped: 0,
  failures: 0,
  redactions: 0,
})
