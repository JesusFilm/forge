import { z } from "zod"

/** The three independent detection sources (KTD3). */
export const triageSignalKindSchema = z.enum(["issue", "monitor", "spike"])

export type TriageSignalKind = z.infer<typeof triageSignalKindSchema>

/**
 * Per-source cursor key. Kept as one helper so detection, the repository, and
 * the runbook's liveness query cannot drift on the format.
 */
export function cursorSource(kind: TriageSignalKind, service: string): string {
  return `${kind}:${service}`
}

export const triageCursorSchema = z.object({
  source: z.string().min(1).max(200),
  cursorAt: z.string().datetime({ offset: true }),
  lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
})

export type TriageCursor = z.infer<typeof triageCursorSchema>

export const seenIssueSchema = z.object({
  issueId: z.string().min(1).max(200),
  service: z.string().min(1).max(120),
  epoch: z.number().int().nonnegative(),
  baselineRate: z.number().nonnegative(),
  lastActivityAt: z.string().datetime({ offset: true }),
  firstSeenAt: z.string().datetime({ offset: true }),
})

export type SeenIssue = z.infer<typeof seenIssueSchema>

/**
 * A seen-issue write. `requiredActionKey` is the write-ordering guard (KTD2):
 * when set, the repository refuses the whole batch unless that outbox row is
 * already durable, so a crash can re-process a signal but never lose one.
 */
export const seenIssueUpdateSchema = seenIssueSchema.extend({
  requiredActionKey: z.string().min(1).max(200).optional(),
})

export type SeenIssueUpdate = z.infer<typeof seenIssueUpdateSchema>

export const monitorStateSchema = z.object({
  monitorId: z.string().min(1).max(200),
  service: z.string().min(1).max(120),
  overallState: z.string().min(1).max(60),
  lastEpisodeStartedAt: z.string().datetime({ offset: true }).nullable(),
  lastTicketedAt: z.string().datetime({ offset: true }).nullable(),
})

export type MonitorState = z.infer<typeof monitorStateSchema>

export const monitorStateUpdateSchema = monitorStateSchema.extend({
  requiredActionKey: z.string().min(1).max(200).optional(),
})

export type MonitorStateUpdate = z.infer<typeof monitorStateUpdateSchema>

export const spikeBaselineSchema = z.object({
  service: z.string().min(1).max(120),
  spikeClass: z.string().min(1).max(120),
  baselineRate: z.number().nonnegative(),
  observations: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  lastTicketedAt: z.string().datetime({ offset: true }).nullable(),
})

export type SpikeBaseline = z.infer<typeof spikeBaselineSchema>

export const spikeBaselineUpdateSchema = spikeBaselineSchema.extend({
  requiredActionKey: z.string().min(1).max(200).optional(),
})

export type SpikeBaselineUpdate = z.infer<typeof spikeBaselineUpdateSchema>

/** Linear title bound. One owner, so the cut and the validator cannot drift. */
export const TRIAGE_TITLE_MAX_CHARS = 200

/** Linear description bound. Same one-owner rule as the title above. */
export const TRIAGE_DESCRIPTION_MAX_CHARS = 12_000

/**
 * A ticket intent. `description` already carries the idempotency marker
 * comment the dispatcher searches Linear for before every create.
 */
export const triageActionDraftSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  service: z.string().min(1).max(120),
  signalKind: triageSignalKindSchema,
  signalId: z.string().min(1).max(200),
  epoch: z.number().int().nonnegative(),
  title: z.string().min(1).max(TRIAGE_TITLE_MAX_CHARS),
  description: z.string().min(1).max(TRIAGE_DESCRIPTION_MAX_CHARS),
  labelId: z.string().min(1).optional(),
})

export type TriageActionDraft = z.infer<typeof triageActionDraftSchema>

export const triageRunStatusSchema = z.enum([
  "complete",
  "partial",
  "disabled",
  "failed",
  "already_running",
])

export const triageRunCountersSchema = z.object({
  servicesCovered: z.number().int().nonnegative().default(0),
  servicesSeeded: z.number().int().nonnegative().default(0),
  signalsFetched: z.number().int().nonnegative().default(0),
  signalsExcludedDevSession: z.number().int().nonnegative().default(0),
  signalsExcludedMuted: z.number().int().nonnegative().default(0),
  signalsExcludedBaselined: z.number().int().nonnegative().default(0),
  /** Rows Datadog returned for a service the coverage list does not name. */
  signalsExcludedForeignService: z.number().int().nonnegative().default(0),
  candidates: z.number().int().nonnegative().default(0),
  candidatesCapped: z.number().int().nonnegative().default(0),
  judged: z.number().int().nonnegative().default(0),
  judgeFailures: z.number().int().nonnegative().default(0),
  suppressed: z.number().int().nonnegative().default(0),
  alreadyTicketed: z.number().int().nonnegative().default(0),
  actionsEnqueued: z.number().int().nonnegative().default(0),
  actionsCreated: z.number().int().nonnegative().default(0),
  actionsDeduplicated: z.number().int().nonnegative().default(0),
  actionsDeferred: z.number().int().nonnegative().default(0),
  epochsMinted: z.number().int().nonnegative().default(0),
  failures: z.number().int().nonnegative().default(0),
})

export type TriageRunCounters = z.infer<typeof triageRunCountersSchema>

export const emptyTriageRunCounters = (): TriageRunCounters =>
  triageRunCountersSchema.parse({})

export const triageSourceOutcomeSchema = z.object({
  source: z.string().min(1).max(200),
  status: z.enum(["ok", "partial", "failed", "skipped"]),
  reason: z.string().max(120).optional(),
})

export type TriageSourceOutcome = z.infer<typeof triageSourceOutcomeSchema>

export const triageRunReportSchema = z.object({
  runKey: z.string().min(1).max(200),
  status: triageRunStatusSchema,
  windowStart: z.string().datetime({ offset: true }),
  windowEnd: z.string().datetime({ offset: true }),
  counters: triageRunCountersSchema,
  sources: z.array(triageSourceOutcomeSchema).max(60),
  issueUrls: z.array(z.string().url().max(2_048)).max(25),
  errors: z.array(z.string().max(200)).max(50),
  partialReason: z.string().max(200).optional(),
})

export type TriageRunReport = z.infer<typeof triageRunReportSchema>
