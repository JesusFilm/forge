import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "../candidate"
import { HYBRID_PERSONALIZED_MANIFEST } from "../promotion/manifest"
import {
  createShadowEvaluation,
  claimNextShadowRun,
  executeClaimedShadowRun,
  completeShadowEvaluation,
} from "../shadow-evaluation/service"
import { MMR_SLATE_POLICY_VERSION } from "./mmr"
import { compositionDigest } from "./policy"
import {
  prepareCompositionProtocol,
  decideCompositionProtocol,
  recordCompositionCalibration,
  resolveCompositionQualification,
  inspectComposition,
  purgeExpiredCompositionEvidence,
  type CompositionBinding,
} from "./service"
import { composeAuthorizedMmrSlate } from "./live"
import { nominations, slate, thresholds } from "./test-helpers"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "composition authority on PostgreSQL",
  () => {
    let db: PrismaClient
    const challengerId = `fixture-mmr-${randomUUID()}`
    const actor = { id: "owned-composition-fixture", role: "ADMIN" } as const
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test database required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
      await db.recommendationStrategyManifest.upsert({
        where: { id: HYBRID_PERSONALIZED_MANIFEST.id },
        create: HYBRID_PERSONALIZED_MANIFEST,
        update: {},
      })
      await db.recommendationStrategyManifest.create({
        data: {
          ...HYBRID_PERSONALIZED_MANIFEST,
          id: challengerId,
          strategyVersion: challengerId,
          configuration: { composer: MMR_SLATE_POLICY_VERSION },
        },
      })
    })
    // Immutable history stays in this disposable owned fixture until expiry.
    afterAll(async () => {
      await db?.$disconnect()
    })

    async function fixture(
      options: { profile?: boolean; minimumRuns?: number } = {},
    ) {
      const now = new Date(Date.now() - 2_000)
      const evaluationId = randomUUID(),
        protocolId = randomUUID(),
        requestId = randomUUID(),
        runId = randomUUID()
      const operator = { actor, authenticatedAt: now }
      const input = {
        protocolId,
        shadowEvaluationId: evaluationId,
        sourceManifestId: HYBRID_PERSONALIZED_MANIFEST.id,
        generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
        challengerManifestId: challengerId,
        thresholds: { ...thresholds, minimumRuns: options.minimumRuns ?? 1 },
      }
      const protocol = await prepareCompositionProtocol(
        db,
        operator,
        input,
        now,
      )
      await createShadowEvaluation(db, {
        evaluationId,
        manifestId: input.sourceManifestId,
        generatorVersion: input.generatorVersion,
        contextVersion: "fixture-context-v1",
        eligibilityVersion: "fixture-eligibility-v1",
        windowStart: new Date(now.getTime() - 2 * 86_400_000),
        windowEnd: new Date(now.getTime() - 86_400_000),
        requestedSampleSize: 1,
        now,
      })
      const createdAt = new Date(now.getTime() - 86_400_000),
        expiresAt = new Date(createdAt.getTime() + 29 * 86_400_000)
      const profile = options.profile
        ? await db.recommendationProfile.create({
            data: {
              privacyGeneration: 1,
              tokenDigest: compositionDigest(runId),
              choice: "DURABLE_ALLOWED",
              expiresAt,
            },
          })
        : null
      await db.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
          data: {
            id: requestId,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId: input.sourceManifestId,
            strategyVersion: HYBRID_PERSONALIZED_MANIFEST.strategyVersion,
            classifierVersion: "legacy-position-v0",
            sessionDigest: compositionDigest(requestId),
            locale: "en",
            seedMediaId: "seed-video",
            expectedItemCount: 2,
            state: "ISSUED",
            result: "SERVED",
            deliveryJti: randomUUID(),
            signingKid: "fixture",
            issuedAt: createdAt,
            createdAt,
            expiresAt,
          },
        })
        for (const [position, row] of nominations().slice(0, 2).entries())
          await tx.recommendationServedItem.create({
            data: {
              requestId,
              position,
              targetMediaId: row.targetMediaId,
              canonicalHref: `/watch/${row.targetMediaId}.html`,
              candidateGenerator: "semantic",
              candidateProvenance: {},
              capabilityJti: randomUUID(),
              signingKid: "fixture",
              presentation: row.presentation,
              createdAt,
              expiresAt,
            },
          })
      })
      await db.recommendationShadowRun.create({
        data: {
          id: runId,
          evaluationId,
          requestId,
          projectionProfileId: profile?.id,
          privacyGeneration: profile ? 1 : null,
          sampleOrdinal: 0,
          samplingDigest: compositionDigest(runId),
          contextProjectionVersion: "fixture-context-v1",
          eligibilityVersion: "fixture-eligibility-v1",
          retentionPolicyVersion: "fixture-root-v1",
          inputCapturedAt: createdAt,
          expiresAt,
        },
      })
      await db.recommendationShadowEvaluation.update({
        where: { id: evaluationId },
        data: { sampledCount: 1 },
      })
      const executionAt = new Date(now.getTime() + 1_000)
      const claim = await claimNextShadowRun(db, {
        evaluationId,
        expectedGeneration: 1,
        now: executionAt,
      })
      if (claim.status !== "claimed")
        throw new Error("fixture claim unavailable")
      const execution = {
        runId,
        expectedRunGeneration: claim.generation,
        expectedEvaluationGeneration: 1,
        claimId: claim.claimId,
        generator: async () => ({
          nominations: nominations(),
          projectionCapturedAt: executionAt,
          cohortQuality: 0.9,
        }),
        now: executionAt,
      }
      expect(await executeClaimedShadowRun(db, execution)).toMatchObject({
        status: "published",
        replay: false,
      })
      expect(await executeClaimedShadowRun(db, execution)).toMatchObject({
        status: "published",
        replay: true,
      })
      await completeShadowEvaluation(db, {
        evaluationId,
        expectedGeneration: 1,
        minimumRuns: 1,
        now: executionAt,
      })
      return {
        now: executionAt,
        operator,
        input,
        protocol,
        evaluationId,
        protocolId,
        requestId,
        runId,
        profile,
      }
    }
    async function qualified(options: Parameters<typeof fixture>[0] = {}) {
      const f = await fixture(options)
      const decision = await decideCompositionProtocol(
        db,
        f.operator,
        f.protocolId,
        f.now,
      )
      expect(decision.decision).toBe("qualify_for_controlled_study")
      const reviewInput = {
        protocolId: f.protocolId,
        configDigest: f.protocol.configDigest,
        evidenceDigest: decision.evidenceDigest,
        rationale:
          "Fixture-only review of measured structural observations; no production usefulness claim.",
      }
      const review = await recordCompositionCalibration(
        db,
        f.operator,
        reviewInput,
        f.now,
      )
      const binding: CompositionBinding = {
        protocolId: f.protocolId,
        manifestId: challengerId,
        composerVersion: MMR_SLATE_POLICY_VERSION,
        configDigest: f.protocol.configDigest,
        evidenceDigest: decision.evidenceDigest,
        reviewDigest: review.reviewDigest,
        authorityRevision: 1,
      }
      expect(
        await resolveCompositionQualification(db, binding, f.now),
      ).not.toBeNull()
      return { ...f, decision, review, reviewInput, binding }
    }

    it("persists separate evidence atomically and requires exact calibration after candidate PASS", async () => {
      const f = await fixture()
      const candidate = await db.recommendationShadowDecision.findUniqueOrThrow(
        { where: { evaluationId: f.evaluationId } },
      )
      expect(candidate.decision).toBe("PROMOTE_TO_EXPERIMENT")
      const inspection = await inspectComposition(
        db,
        actor,
        f.protocolId,
        f.now,
      )
      expect(inspection).toMatchObject({
        qualification: "unavailable",
        calibrationStatus: "uncalibrated",
        usefulness: "not_evaluated",
      })
      expect(
        inspection?.traces[0]?.run.nominations[0]?.provenance,
      ).toMatchObject({ slateDecision: "pending" })
      expect(
        await db.recommendationCompositionObservation.count({
          where: { protocolId: f.protocolId },
        }),
      ).toBe(1)
      const decision = await decideCompositionProtocol(
        db,
        f.operator,
        f.protocolId,
        f.now,
      )
      expect(decision.decision).toBe("qualify_for_controlled_study")
      await expect(
        recordCompositionCalibration(
          db,
          f.operator,
          {
            protocolId: f.protocolId,
            configDigest: "a".repeat(64),
            evidenceDigest: decision.evidenceDigest,
            rationale: "Mismatched exact config must never qualify.",
          },
          f.now,
        ),
      ).rejects.toThrow("binding_invalid")
    })
    it("converges immutable prepare/decision/calibration replay and rejects edits", async () => {
      const f = await qualified()
      expect(
        (await prepareCompositionProtocol(db, f.operator, f.input, f.now)).id,
      ).toBe(f.protocolId)
      expect(
        (await decideCompositionProtocol(db, f.operator, f.protocolId, f.now))
          .evidenceDigest,
      ).toBe(f.decision.evidenceDigest)
      expect(
        (
          await recordCompositionCalibration(
            db,
            f.operator,
            f.reviewInput,
            f.now,
          )
        ).reviewDigest,
      ).toBe(f.review.reviewDigest)
      await expect(
        prepareCompositionProtocol(
          db,
          f.operator,
          { ...f.input, thresholds: { ...thresholds, maxLatencyMs: 20 } },
          f.now,
        ),
      ).rejects.toThrow("conflict")
      await expect(
        db.recommendationCompositionDecision.update({
          where: { protocolId: f.protocolId },
          data: { decision: "retire" },
        }),
      ).rejects.toThrow("immutable")
    })
    it.each([
      "root_delete",
      "run_generation",
      "run_context",
      "profile_generation",
      "profile_state",
      "profile_delete",
      "observation_delete",
      "request_state",
    ] as const)(
      "immediately revokes approved authority on %s",
      async (kind) => {
        const f = await qualified({ profile: true })
        if (kind === "root_delete")
          await db.recommendationRequest.delete({ where: { id: f.requestId } })
        if (kind === "run_generation")
          await db.recommendationShadowRun.update({
            where: { id: f.runId },
            data: { generation: { increment: 1 } },
          })
        if (kind === "run_context")
          await db.recommendationShadowRun.update({
            where: { id: f.runId },
            data: { contextProjectionVersion: "changed-context-v2" },
          })
        if (kind === "profile_generation")
          await db.recommendationProfile.update({
            where: { id: f.profile!.id },
            data: { privacyGeneration: { increment: 1 } },
          })
        if (kind === "profile_state")
          await db.recommendationProfile.update({
            where: { id: f.profile!.id },
            data: {
              state: "TOMBSTONED",
              tokenDigest: null,
              tombstonedAt: f.now,
              tombstoneReason: "fixture",
              erasureState: "PENDING",
            },
          })
        if (kind === "profile_delete")
          await db.recommendationProfile.delete({
            where: { id: f.profile!.id },
          })
        if (kind === "observation_delete")
          await db.recommendationCompositionObservation.delete({
            where: { runId: f.runId },
          })
        if (kind === "request_state")
          await db.recommendationRequest.update({
            where: { id: f.requestId },
            data: { state: "ISSUANCE_FAILED" },
          })
        expect(
          await resolveCompositionQualification(db, f.binding, f.now),
        ).toBeNull()
        expect(
          await db.recommendationCompositionObservation.count({
            where: { protocolId: f.protocolId },
          }),
        ).toBe(0)
        expect(
          await db.recommendationCompositionDecision.findUnique({
            where: { protocolId: f.protocolId },
          }),
        ).not.toBeNull()
        await expect(
          recordCompositionCalibration(db, f.operator, f.reviewInput, f.now),
        ).rejects.toThrow("revoked")
      },
    )
    it("refuses expiry equality and changed manifest/version/review without deleting historical aggregate", async () => {
      const f = await qualified()
      expect(
        await resolveCompositionQualification(
          db,
          f.binding,
          f.decision.validUntil,
        ),
      ).toBeNull()
      for (const changed of [
        { manifestId: "other" },
        { composerVersion: "other" },
        { evidenceDigest: "f".repeat(64) },
        { reviewDigest: "f".repeat(64) },
        { authorityRevision: 2 },
      ])
        expect(
          await resolveCompositionQualification(
            db,
            { ...f.binding, ...changed },
            f.now,
          ),
        ).toBeNull()
    })
    it("keeps insufficient composition samples inconclusive despite candidate approval", async () => {
      const f = await fixture({ minimumRuns: 2 })
      expect(
        await decideCompositionProtocol(db, f.operator, f.protocolId, f.now),
      ).toMatchObject({ decision: "inconclusive" })
    })
    it("serves MMR only with current exact study authority and records its provenance", async () => {
      const f = await qualified()
      const common = {
        prisma: db,
        binding: f.binding,
        slate: slate(),
        historyAvailable: true,
        deadlineMs: Date.now() + 2_000,
        now: f.now,
      }
      expect(
        await composeAuthorizedMmrSlate({
          ...common,
          verifyStudyAuthority: async () => null,
        }),
      ).toMatchObject({ status: "fallback" })
      const verifyStudyAuthority = async ({
        contextDigest,
      }: {
        contextDigest: string
      }) => ({
        binding: f.binding,
        contextDigest,
        experimentId: "fixture-study",
        experimentGeneration: 1,
        studyProtocolDigest: "b".repeat(64),
        challengerManifestId: challengerId,
        validUntil: f.decision.validUntil,
      })
      expect(
        await composeAuthorizedMmrSlate({ ...common, verifyStudyAuthority }),
      ).toMatchObject({
        status: "composed",
        provenance: {
          composerVersion: MMR_SLATE_POLICY_VERSION,
          experimentId: "fixture-study",
          compositionEvidenceDigest: f.decision.evidenceDigest,
        },
      })
      expect(
        await composeAuthorizedMmrSlate({
          ...common,
          historyAvailable: false,
          verifyStudyAuthority,
        }),
      ).toMatchObject({
        status: "fallback",
        provenance: { reason: "composition_required_input_unavailable" },
      })
      expect(
        await composeAuthorizedMmrSlate({
          ...common,
          verifyStudyAuthority: async (input) => {
            await db.recommendationRequest.delete({
              where: { id: f.requestId },
            })
            return verifyStudyAuthority(input)
          },
        }),
      ).toMatchObject({
        status: "fallback",
        provenance: { reason: "composition_qualification_revoked" },
      })
    })
    it("enforces recent human operator permission independently of the route", async () => {
      const f = await fixture()
      await expect(
        decideCompositionProtocol(
          db,
          { actor: { id: null, role: "SYSTEM" }, authenticatedAt: f.now },
          f.protocolId,
          f.now,
        ),
      ).rejects.toThrow("authentication")
      await expect(
        decideCompositionProtocol(
          db,
          { actor, authenticatedAt: new Date(f.now.getTime() - 16 * 60_000) },
          f.protocolId,
          f.now,
        ),
      ).rejects.toThrow("authentication")
    })
    it("fences approval after expiry, permits concurrent exact decisions, and cannot rewrite frozen policy", async () => {
      const f = await fixture()
      const [first, second] = await Promise.all([
        decideCompositionProtocol(db, f.operator, f.protocolId, f.now),
        decideCompositionProtocol(db, f.operator, f.protocolId, f.now),
      ])
      expect(first.evidenceDigest).toBe(second.evidenceDigest)
      await expect(
        recordCompositionCalibration(
          db,
          { actor, authenticatedAt: first.validUntil },
          {
            protocolId: f.protocolId,
            configDigest: f.protocol.configDigest,
            evidenceDigest: first.evidenceDigest,
            rationale: "Expired observations cannot authorize this policy.",
          },
          first.validUntil,
        ),
      ).rejects.toThrow("expired")
      await expect(
        db.recommendationCompositionProtocol.update({
          where: { id: f.protocolId },
          data: { configDigest: "f".repeat(64) },
        }),
      ).rejects.toThrow("immutable")
      await expect(
        db.recommendationCompositionObservation.update({
          where: { runId: f.runId },
          data: { inputDigest: "f".repeat(64) },
        }),
      ).rejects.toThrow("immutable")
    })
    it("purges expired aggregate roots with immutable child history and leaves current evidence", async () => {
      const now = new Date()
      const createdAt = new Date(now.getTime() - 366 * 86_400_000)
      const protocol = await prepareCompositionProtocol(
        db,
        { actor, authenticatedAt: createdAt },
        {
          protocolId: randomUUID(),
          shadowEvaluationId: randomUUID(),
          sourceManifestId: HYBRID_PERSONALIZED_MANIFEST.id,
          generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
          challengerManifestId: challengerId,
          thresholds,
        },
        createdAt,
      )
      await db.recommendationCompositionDecision.create({
        data: {
          protocolId: protocol.id,
          decision: "inconclusive",
          reasonCode: "fixture_retention",
          evidenceVersion: "fixture",
          evidenceDigest: "a".repeat(64),
          inputDigest: "b".repeat(64),
          observationCount: 0,
          summary: {},
          authorityRevision: 1,
          validUntil: protocol.expiresAt,
          decidedAt: createdAt,
          expiresAt: protocol.expiresAt,
        },
      })
      const result = await db.$transaction((tx) =>
        purgeExpiredCompositionEvidence(tx, now),
      )
      expect(result.protocols).toBe(1)
      expect(
        await db.recommendationCompositionDecision.findUnique({
          where: { protocolId: protocol.id },
        }),
      ).toBeNull()
      expect(
        await db.recommendationCompositionProtocol.count(),
      ).toBeGreaterThan(0)
    })
  },
)
