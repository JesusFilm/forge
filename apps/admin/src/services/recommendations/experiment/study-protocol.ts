import { createHash } from "node:crypto"
import { z } from "zod"
import {
  digestValue,
  INCUMBENT_HYBRID_MANIFEST_ID,
  INCUMBENT_HYBRID_AA_MANIFEST_ID,
  COWATCH_MMR_TRIAL_MANIFEST_ID,
} from "../promotion/manifest"
import { MMR_SLATE_POLICY_VERSION } from "../composition/mmr"
import { RecommendationInputError } from "../errors"

export const STUDY_POLICY_VERSION = "profile-study-governance-v1"
export const STUDY_DAY_MS = 86_400_000
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const date = z.string().datetime({ offset: false })
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)

const CowatchStudyBindingSchema = z
  .object({
    mode: z.literal("frozen-source-controlled-trial-v1"),
    graphGenerationId: digest,
    sourceWindow: z
      .object({
        version: z.literal("episode-event-window-v1"),
        windowStart: date,
        windowEnd: date,
        evaluationAsOf: date,
      })
      .strict(),
    calibrationCompletedAt: date,
    trialValidUntil: date,
    earliestDependencyExpiresAt: date,
    shadowEvaluationId: z.string().uuid(),
    shadowDecisionId: z.string().uuid(),
  })
  .strict()
const CompositionStudyBindingSchema = z
  .object({
    protocolId: z.string().uuid(),
    manifestId: z.literal(COWATCH_MMR_TRIAL_MANIFEST_ID),
    composerVersion: z.literal(MMR_SLATE_POLICY_VERSION),
    configDigest: digest,
    evidenceDigest: digest,
    reviewDigest: digest,
    authorityRevision: z.number().int().nonnegative(),
    cowatchGenerationId: digest,
  })
  .strict()

// Adding a new challenger requires an exact runtime adapter and its own reviewed
// comparator. This is deliberately not an arbitrary-manifest approval mechanism.
export const StudyProtocolSchema = z
  .object({
    version: z.literal(STUDY_POLICY_VERSION),
    studyId: id,
    mode: z.enum(["calibration", "efficacy"]),
    comparison: z.enum([
      "semantic-aa",
      "semantic-profile",
      "incumbent-aa",
      "incumbent-cowatch-mmr",
    ]),
    identity: z.literal("anonymous-profile-generation-v1"),
    surface: z.literal("watch-below-player-v1"),
    cohort: z.literal("human-en-english-durable-v1"),
    controlManifestId: z.enum([
      "semantic-transcript-pgvector-v1",
      INCUMBENT_HYBRID_MANIFEST_ID,
    ]),
    challengerManifestId: z.enum([
      "semantic-experiment-aa-v1",
      "semantic-profile-hybrid-v1",
      INCUMBENT_HYBRID_AA_MANIFEST_ID,
      COWATCH_MMR_TRIAL_MANIFEST_ID,
    ]),
    controlManifestDigest: digest,
    challengerManifestDigest: digest,
    // Existing durable-profile delivery is hybrid. A semantic comparison cannot
    // certify an incremental co-watch/MMR improvement over that incumbent.
    incumbentExecution: z.literal("hybrid_personalized"),
    controlExecution: z.enum([
      "semantic_contextual",
      "profile-viewing-mode-incumbent-v1",
    ]),
    // Optional only for the legacy semantic protocol shape; new incumbent
    // calibration must be graph-free, and bundle efficacy requires both.
    cowatch: CowatchStudyBindingSchema.nullable().optional(),
    composition: CompositionStudyBindingSchema.nullable().optional(),
    admissionBps: z
      .number()
      .int()
      .min(2)
      .max(10_000)
      .refine((n) => n % 2 === 0),
    challengerProbability: z.literal(0.5),
    startsAt: date,
    endsAt: date,
    expiresAt: date,
    stoppingRule: z.literal("fixed-enrollment-window-v1"),
    plannedAssignmentsPerArm: z.number().int().min(200).max(50_000),
    minimumUsefulDelta: z.number().finite().positive().nullable(),
    evidenceMaxAgeHours: z.number().int().min(1).max(24),
    calibrationEvaluationId: z.string().min(1).max(191).nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const start = Date.parse(p.startsAt),
      end = Date.parse(p.endsAt),
      expiry = Date.parse(p.expiresAt)
    if (
      end <= start ||
      end - start > 14 * STUDY_DAY_MS ||
      expiry <= end + 30 * 3_600_000 ||
      expiry - start >= 29 * STUDY_DAY_MS
    )
      ctx.addIssue({
        code: "custom",
        message: "Enrollment, follow-up or retention horizon is invalid",
      })
    if (
      p.mode === "calibration" &&
      (!["semantic-aa", "incumbent-aa"].includes(p.comparison) ||
        end - start < 2 * STUDY_DAY_MS ||
        start % STUDY_DAY_MS !== 0 ||
        end % STUDY_DAY_MS !== 0 ||
        p.calibrationEvaluationId !== null ||
        p.minimumUsefulDelta !== null)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Calibration requires two complete UTC days and exact equivalent arms",
      })
    if (
      p.mode === "efficacy" &&
      (!["semantic-profile", "incumbent-cowatch-mmr"].includes(p.comparison) ||
        p.calibrationEvaluationId === null ||
        p.minimumUsefulDelta === null)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Efficacy requires an exact challenger and prior calibration authority",
      })
    const incumbent =
      p.comparison === "incumbent-aa" ||
      p.comparison === "incumbent-cowatch-mmr"
    const expectedChallenger = {
      "semantic-aa": "semantic-experiment-aa-v1",
      "semantic-profile": "semantic-profile-hybrid-v1",
      "incumbent-aa": INCUMBENT_HYBRID_AA_MANIFEST_ID,
      "incumbent-cowatch-mmr": COWATCH_MMR_TRIAL_MANIFEST_ID,
    }[p.comparison]
    if (
      p.controlManifestId !==
        (incumbent
          ? INCUMBENT_HYBRID_MANIFEST_ID
          : "semantic-transcript-pgvector-v1") ||
      p.controlExecution !==
        (incumbent
          ? "profile-viewing-mode-incumbent-v1"
          : "semantic_contextual") ||
      p.challengerManifestId !== expectedChallenger
    )
      ctx.addIssue({
        code: "custom",
        message: "Study comparator and exact execution manifests disagree",
      })
    if (p.comparison === "incumbent-cowatch-mmr") {
      const graph = p.cowatch
      if (
        !graph ||
        !p.composition ||
        graph.graphGenerationId !== p.composition.cowatchGenerationId ||
        Date.parse(graph.trialValidUntil) !== end + 30 * 3_600_000 ||
        Date.parse(graph.earliestDependencyExpiresAt) <=
          Date.parse(graph.trialValidUntil) ||
        Date.parse(graph.calibrationCompletedAt) >= start ||
        Date.parse(graph.sourceWindow.windowStart) >=
          Date.parse(graph.sourceWindow.windowEnd) ||
        Date.parse(graph.sourceWindow.windowEnd) >
          Date.parse(graph.sourceWindow.evaluationAsOf) ||
        Date.parse(graph.sourceWindow.evaluationAsOf) >= start
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Exact graph and composition bindings must cover complete trial follow-up",
        })
    } else if (p.cowatch != null || p.composition != null) {
      ctx.addIssue({
        code: "custom",
        message:
          "This comparator is graph-free and has no composition authority",
      })
    }
  })
export type StudyProtocol = z.infer<typeof StudyProtocolSchema>
export function parseStudyProtocol(value: unknown): StudyProtocol {
  const result = StudyProtocolSchema.safeParse(value)
  if (!result.success)
    throw new RecommendationInputError("Invalid immutable study protocol")
  return result.data
}
export const studyMatchesIncumbent = (p: StudyProtocol) =>
  p.comparison === "incumbent-aa" || p.comparison === "incumbent-cowatch-mmr"

export function studyExperimentMatchesProtocol(
  experiment: {
    id: string
    controlManifestId: string
    challengerManifestId: string
    startsAt: Date
    endsAt: Date
    expiresAt: Date
    challengerProbability: number
  },
  p: StudyProtocol,
) {
  return (
    experiment.id === p.studyId &&
    experiment.controlManifestId === p.controlManifestId &&
    experiment.challengerManifestId === p.challengerManifestId &&
    experiment.challengerProbability === 0.5 &&
    experiment.startsAt.getTime() === Date.parse(p.startsAt) &&
    experiment.endsAt.getTime() === Date.parse(p.endsAt) &&
    experiment.expiresAt.getTime() === Date.parse(p.expiresAt)
  )
}

export const studyProtocolDigest = (protocol: StudyProtocol) =>
  digestValue(protocol)
export const studyChallengerCeilingBps = (protocol: StudyProtocol) =>
  protocol.admissionBps / 2

export function isStudyAdmitted(
  unitDigest: string,
  protocolDigest: string,
  admissionBps: number,
): boolean {
  const bytes = createHash("sha256")
    .update(
      `recommendation-study-admission:v1\0${protocolDigest}\0${unitDigest}`,
    )
    .digest()
  return bytes.readUIntBE(0, 6) / 2 ** 48 < admissionBps / 10_000
}

const ReceiptSchema = z
  .object({
    source: z.enum([
      "datadog",
      "browser-receipts",
      "postgres",
      "reviewed-artifact",
    ]),
    reference: z
      .string()
      .min(1)
      .max(512)
      .refine((s) => !/[\r\n]/.test(s) && !s.includes(String.fromCharCode(0))),
    sha256: digest,
  })
  .strict()
const ArmSchema = z
  .object({
    requests: z.number().int().nonnegative(),
    timeoutsOrErrors: z.number().int().nonnegative(),
    requestsWithCards: z.number().int().nonnegative(),
    p95LatencyMs: z.number().finite().nonnegative(),
    claimedEpisodes: z.number().int().nonnegative(),
    missingActiveEpisodes: z.number().int().nonnegative(),
    attributionFailures: z.number().int().nonnegative(),
    fatalPlaybackErrors: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (a) =>
      a.timeoutsOrErrors <= a.requests &&
      a.requestsWithCards <= a.requests &&
      a.attributionFailures <= a.requests &&
      a.missingActiveEpisodes <= a.claimedEpisodes &&
      a.fatalPlaybackErrors <= a.claimedEpisodes,
  )
export const StudyEvidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("readiness"),
      capturedAt: date,
      validUntil: date,
      collection: ReceiptSchema,
      retention: ReceiptSchema,
      storage: ReceiptSchema,
      rollback: ReceiptSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("outcomes"),
      capturedAt: date,
      validUntil: date,
      windowStart: date,
      windowEnd: date,
      delivery: ReceiptSchema,
      playback: ReceiptSchema,
      collection: ReceiptSchema,
      retention: ReceiptSchema,
      browserJourney: ReceiptSchema,
      control: ArmSchema,
      challenger: ArmSchema,
    })
    .strict(),
])
export type StudyEvidence = z.infer<typeof StudyEvidenceSchema>
export function parseStudyEvidence(
  value: unknown,
  protocol: StudyProtocol,
  now: Date,
): StudyEvidence {
  const parsed = StudyEvidenceSchema.safeParse(value)
  if (!parsed.success)
    throw new RecommendationInputError("Invalid reviewed evidence")
  const e = parsed.data,
    captured = Date.parse(e.capturedAt),
    expiry = Date.parse(e.validUntil)
  if (
    captured > now.getTime() ||
    expiry <= now.getTime() ||
    expiry > Date.parse(protocol.expiresAt) ||
    now.getTime() - captured > protocol.evidenceMaxAgeHours * 3_600_000 ||
    expiry - captured > protocol.evidenceMaxAgeHours * 3_600_000
  )
    throw new RecommendationInputError(
      "Evidence is stale or outside its validity horizon",
    )
  if (
    e.kind === "outcomes" &&
    (e.windowStart !== protocol.startsAt ||
      Date.parse(e.windowEnd) !==
        Date.parse(protocol.endsAt) + 30 * 3_600_000 ||
      captured < Date.parse(e.windowEnd))
  )
    throw new RecommendationInputError(
      "Evidence does not cover the complete study follow-up",
    )
  return e
}
export function studyGuardrails(
  e: Extract<StudyEvidence, { kind: "outcomes" }>,
) {
  const c = e.control,
    t = e.challenger
  const reasons: string[] = []
  if (
    c.requests === 0 ||
    t.requests === 0 ||
    c.claimedEpisodes === 0 ||
    t.claimedEpisodes === 0
  )
    return { passed: false, reasons: ["operational_evidence_population_empty"] }
  if (
    c.missingActiveEpisodes / c.claimedEpisodes > 0.05 ||
    t.missingActiveEpisodes / t.claimedEpisodes > 0.05
  )
    reasons.push("missing_active_coverage")
  if (
    Math.abs(
      c.missingActiveEpisodes / c.claimedEpisodes -
        t.missingActiveEpisodes / t.claimedEpisodes,
    ) > 0.02
  )
    reasons.push("coverage_arm_difference")
  if (
    Math.abs(
      c.attributionFailures / c.requests - t.attributionFailures / t.requests,
    ) > 0.02
  )
    reasons.push("attribution_arm_difference")
  if (t.timeoutsOrErrors / t.requests - c.timeoutsOrErrors / c.requests > 0.01)
    reasons.push("delivery_errors")
  if (
    c.requestsWithCards / c.requests - t.requestsWithCards / t.requests >
    0.02
  )
    reasons.push("card_return")
  if (
    t.p95LatencyMs - c.p95LatencyMs > 200 ||
    Math.max(c.p95LatencyMs, t.p95LatencyMs) > 1500
  )
    reasons.push("delivery_latency")
  if (
    t.fatalPlaybackErrors / t.claimedEpisodes -
      c.fatalPlaybackErrors / c.claimedEpisodes >
    0.01
  )
    reasons.push("fatal_playback")
  return { passed: reasons.length === 0, reasons }
}
