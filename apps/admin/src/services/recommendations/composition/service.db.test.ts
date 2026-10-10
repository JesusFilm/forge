import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "../candidate"
import {
  HYBRID_PERSONALIZED_MANIFEST,
  COWATCH_MMR_TRIAL_MANIFEST,
} from "../promotion/manifest"
import { COWATCH_SHADOW_GENERATOR_KEY } from "../cowatch/graph"
import {
  compositionGraphFixture,
  playableCompositionGraph,
} from "./graph.test-fixture"
import {
  createShadowEvaluation,
  claimNextShadowRun,
  executeClaimedShadowRun,
  completeShadowEvaluation,
} from "../shadow-evaluation/service"
import { MMR_SLATE_POLICY_VERSION } from "./mmr"
import { compositionDigest, observeComposition } from "./policy"
import { createDatabaseCowatchLiveSource } from "../cowatch/live.service"
import {
  COWATCH_FROZEN_TRIAL_MODE,
  qualifyCowatchTrialAuthority,
  type CowatchTrialBinding,
} from "../cowatch/trial-authority.service"
import { recommendationManifestDigest } from "../promotion/manifest"
import { runCandidatePlatform } from "../orchestration"
import {
  prepareCompositionProtocol,
  persistCompositionObservation,
  decideCompositionProtocol,
  recordCompositionCalibration,
  resolveCompositionQualification,
  resolveRetainedCompositionQualification,
  lockCompositionQualificationForIssuance,
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
      await db.recommendationStrategyManifest.upsert({
        where: { id: COWATCH_MMR_TRIAL_MANIFEST.id },
        create: COWATCH_MMR_TRIAL_MANIFEST,
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
      options: {
        profile?: boolean
        minimumRuns?: number
        graph?: Awaited<ReturnType<typeof compositionGraphFixture>>
        evaluationGraphId?: string
        wrongNominationGraph?: boolean
        manualPublication?: boolean
      } = {},
    ) {
      const now = options.graph?.now ?? new Date(Date.now() - 2_000)
      const evaluationId = randomUUID(),
        protocolId = randomUUID(),
        requestId = randomUUID(),
        runId = randomUUID()
      const operator = { actor, authenticatedAt: now }
      const input = {
        protocolId,
        shadowEvaluationId: evaluationId,
        sourceManifestId: options.graph
          ? COWATCH_MMR_TRIAL_MANIFEST.id
          : HYBRID_PERSONALIZED_MANIFEST.id,
        generatorVersion: options.graph
          ? COWATCH_SHADOW_GENERATOR_KEY
          : HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
        challengerManifestId: options.graph
          ? COWATCH_MMR_TRIAL_MANIFEST.id
          : challengerId,
        cowatchGenerationId: options.graph?.generationId ?? null,
        thresholds: { ...thresholds, minimumRuns: options.minimumRuns ?? 1 },
      }
      const protocol = await prepareCompositionProtocol(
        db,
        operator,
        input,
        now,
      )
      if (options.graph) {
        await db.recommendationShadowEvaluation.create({
          data: {
            id: evaluationId,
            manifestId: input.sourceManifestId,
            cowatchGenerationId:
              options.evaluationGraphId ?? options.graph.generationId,
            generatorVersion: input.generatorVersion,
            contextVersion: "fixture-context-v1",
            eligibilityVersion: "fixture-eligibility-v1",
            samplingVersion: "fixture-sampling-v1",
            retentionPolicyVersion: "fixture-root-v1",
            windowStart: new Date(now.getTime() - 2 * 86_400_000),
            windowEnd: new Date(now.getTime() - 86_400_000),
            requestedSampleSize: 1,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 28 * 86_400_000),
          },
        })
      } else {
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
      }
      const createdAt = new Date(now.getTime() - 86_400_000),
        expiresAt = new Date(createdAt.getTime() + 29 * 86_400_000)
      const profile = options.profile
        ? options.graph
          ? await db.recommendationProfile.findUniqueOrThrow({
              where: { id: options.graph.profileId },
            })
          : await db.recommendationProfile.create({
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
          nominations: nominations().map((row, index) =>
            options.wrongNominationGraph && index === 0
              ? {
                  ...row,
                  source: {
                    ...row.source,
                    generator: "directional-cowatch",
                    generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
                    evidence: {
                      ...row.source.evidence,
                      generation: "0".repeat(64),
                    },
                  },
                }
              : row,
          ),
          projectionCapturedAt: executionAt,
          cohortQuality: 0.9,
        }),
        now: executionAt,
      }
      if (options.manualPublication) {
        await db.recommendationShadowRun.update({
          where: { id: runId },
          data: { state: "PUBLISHED", finishedAt: executionAt },
        })
      } else {
        expect(await executeClaimedShadowRun(db, execution)).toMatchObject({
          status: "published",
          replay: false,
        })
        expect(await executeClaimedShadowRun(db, execution)).toMatchObject({
          status: "published",
          replay: true,
        })
        if (options.graph) {
          // Parent owns the integrated candidate gate. This fixture explicitly
          // records its separate terminal result after actual shadow publication.
          await db.recommendationShadowDecision.create({
            data: {
              evaluationId,
              decision: "PROMOTE_TO_EXPERIMENT",
              reasonCode: "native_fixture_only",
              reevaluationCondition: "not_production_evidence",
              inputDigest: compositionDigest(evaluationId),
              decidedAt: executionAt,
              expiresAt,
            },
          })
          await db.recommendationShadowEvaluation.update({
            where: { id: evaluationId },
            data: { state: "TERMINAL" },
          })
        } else {
          await completeShadowEvaluation(db, {
            evaluationId,
            expectedGeneration: 1,
            minimumRuns: 1,
            now: executionAt,
          })
        }
      }
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
        manifestId: f.input.challengerManifestId,
        cowatchGenerationId: f.input.cowatchGenerationId,
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

    it("accepts actual governed U5 live nominations and empties unauthorized graph fallback", async () => {
      const graph = await compositionGraphFixture(db)
      const f = await qualified({ graph })
      await playableCompositionGraph(db, graph)
      const generation =
        await db.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: graph.generationId },
        })
      const candidateDecision =
        await db.recommendationShadowDecision.findUniqueOrThrow({
          where: { evaluationId: f.evaluationId },
        })
      const binding: CowatchTrialBinding = {
        mode: COWATCH_FROZEN_TRIAL_MODE,
        studyId: randomUUID(),
        experimentGeneration: 1,
        protocolDigest: "b".repeat(64),
        manifestId: f.binding.manifestId,
        manifestDigest: recommendationManifestDigest(
          COWATCH_MMR_TRIAL_MANIFEST,
        ),
        graphGenerationId: graph.generationId,
        sourceWindow: {
          version: "episode-event-window-v1",
          windowStart: generation.windowStart!,
          windowEnd: generation.windowEnd,
          evaluationAsOf: generation.evaluationAsOf!,
        },
        calibrationCompletedAt: new Date(generation.publishedAt.getTime() - 1),
        enrollmentEnd: new Date(f.now.getTime() + 86_400_000),
        trialValidUntil: new Date(
          f.now.getTime() + 86_400_000 + 30 * 3_600_000,
        ),
        shadowEvaluationId: f.evaluationId,
        shadowDecisionId: candidateDecision.id,
      }
      expect(
        await qualifyCowatchTrialAuthority(db, binding, f.now),
      ).toMatchObject({ status: "qualified" })
      const source = createDatabaseCowatchLiveSource(db, {
        now: () => f.now,
        resolveActiveAuthority: async (context) => ({
          binding,
          validUntil: binding.trialValidUntil,
          requestContextDigest: context.requestContextDigest,
        }),
      })
      const sourceResult = await source({
        seedMediaId: graph.mediaA,
        locale: "en",
        audioLanguageSlug: "english",
        profileProjectionId: null,
        requestContextDigest: "c".repeat(64),
        deadlineAt: Date.now() + 2000,
      })
      expect(sourceResult).toMatchObject({
        disposition: "candidate",
        fallbackReason: null,
      })
      expect(sourceResult.nominations[0]?.source.generatorVersion).toBe(
        COWATCH_FROZEN_TRIAL_MODE,
      )
      const context = slate().context
      const ordered = runCandidatePlatform({
        nominations: [...sourceResult.nominations, ...nominations()],
        context,
        limit: 6,
        generatorVersion: "fixture",
      }).ordered
      const composeInput = {
        prisma: db,
        binding: f.binding,
        slate: { ordered, context, limit: 6 },
        historyAvailable: true,
        deadlineMs: Date.now() + 2000,
        now: f.now,
      }
      const verifyStudyAuthority = async ({
        contextDigest,
      }: {
        contextDigest: string
      }) => ({
        binding: f.binding,
        contextDigest,
        experimentId: binding.studyId,
        experimentGeneration: 1,
        studyProtocolDigest: binding.protocolDigest,
        challengerManifestId: f.binding.manifestId,
        validUntil: binding.trialValidUntil,
      })
      const composed = await composeAuthorizedMmrSlate({
        ...composeInput,
        verifyStudyAuthority,
      })
      expect(composed.status).toBe("composed")
      expect(
        composed.result.composed.map((row) => row.targetMediaId),
      ).toContain(graph.mediaB)
      const refused = await composeAuthorizedMmrSlate({
        ...composeInput,
        verifyStudyAuthority: async () => null,
      })
      expect(refused.status).toBe("fallback")
      expect(refused.result.composed).toEqual([])
    })
    it.each(["service", "database_guard"] as const)(
      "orders %s publication after a privacy writer without holding its graph",
      async (path) => {
        const graph = await compositionGraphFixture(db)
        const f = await fixture({
          graph,
          profile: true,
          manualPublication: true,
        })
        let held!: () => void, continueWriter!: () => void
        const locked = new Promise<void>((resolve) => {
          held = resolve
        })
        const release = new Promise<void>((resolve) => {
          continueWriter = resolve
        })
        const writer = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM recommendation_profile WHERE id = ${graph.profileId} FOR UPDATE`
          held()
          await release
          await tx.recommendationProfile.update({
            where: { id: graph.profileId },
            data: { privacyGeneration: 2 },
          })
        })
        await locked
        const observation = observeComposition(
          { ...slate(), historyAvailable: true },
          1,
        )
        const publication = db
          .$transaction(async (tx) => {
            if (path === "service")
              return persistCompositionObservation(tx, {
                runId: f.runId,
                observation,
                now: f.now,
              })
            return tx.recommendationCompositionObservation.create({
              data: {
                runId: f.runId,
                protocolId: f.protocolId,
                inputDigest: observation.inputDigest,
                outputDigest: observation.outputDigest,
                metrics: observation.metrics,
                createdAt: f.now,
                expiresAt: graph.expiresAt,
              },
            })
          })
          .then(
            () => ({ ok: true as const }),
            (error) => ({ ok: false as const, error }),
          )
        try {
          await expect
            .poll(
              async () => {
                const rows = await db.$queryRaw<
                  Array<{ blocked: boolean }>
                >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query ILIKE '%recommendation_composition_observation%' OR (query ILIKE '%recommendation_profile%' AND query ILIKE '%FOR SHARE%'))) AS blocked`
                return rows[0]?.blocked
              },
              { timeout: 1000, interval: 10 },
            )
            .toBe(true)
        } finally {
          continueWriter()
        }
        await writer
        const result = await publication
        expect(result.ok).toBe(path === "service")
        if (!result.ok)
          expect(String(result.error)).toContain(
            "composition graph binding unavailable",
          )
        expect(
          await db.recommendationCompositionObservation.count({
            where: { runId: f.runId },
          }),
        ).toBe(0)
      },
    )

    it("binds exact graph identity in preparation, evidence, review and live lookup", async () => {
      const graph = await compositionGraphFixture(db)
      const f = await qualified({ graph })
      expect(f.protocol.config).toMatchObject({
        cowatchGenerationId: graph.generationId,
      })
      expect(f.decision.validUntil.getTime()).toBeLessThanOrEqual(
        graph.expiresAt.getTime(),
      )
      expect(
        await resolveCompositionQualification(
          db,
          { ...f.binding, cowatchGenerationId: "0".repeat(64) },
          f.now,
        ),
      ).toBeNull()
      expect(
        await resolveCompositionQualification(
          db,
          { ...f.binding, cowatchGenerationId: null },
          f.now,
        ),
      ).toBeNull()
      expect(
        await resolveCompositionQualification(
          db,
          f.binding,
          f.decision.validUntil,
        ),
      ).toBeNull()
      expect(
        await resolveRetainedCompositionQualification(
          db,
          f.binding,
          new Date(f.now.getTime() + 86_400_000),
        ),
      ).not.toBeNull()
      await expect(
        prepareCompositionProtocol(
          db,
          f.operator,
          { ...f.input, cowatchGenerationId: null },
          f.now,
        ),
      ).rejects.toThrow("composition_graph_binding_required")
      await expect(
        prepareCompositionProtocol(
          db,
          f.operator,
          { ...f.input, sourceManifestId: HYBRID_PERSONALIZED_MANIFEST.id },
          f.now,
        ),
      ).rejects.toThrow("composition_graph_binding_required")
    })
    it("refuses new composition approval after graph expiry and wrong graph candidate inputs", async () => {
      const graph = await compositionGraphFixture(db)
      const f = await fixture({ graph })
      await expect(
        decideCompositionProtocol(
          db,
          { actor, authenticatedAt: graph.expiresAt },
          f.protocolId,
          graph.expiresAt,
        ),
      ).rejects.toThrow("composition_graph_unavailable")
      const candidateSlate = slate()
      const candidate = candidateSlate.ordered[0]!
      const wrongNomination = {
        ...candidate.selectedNomination,
        source: {
          ...candidate.selectedNomination.source,
          generator: "directional-cowatch",
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          evidence: { generation: "0".repeat(64) },
        },
      }
      const result = await composeAuthorizedMmrSlate({
        prisma: db,
        binding: {
          protocolId: f.protocolId,
          manifestId: f.input.challengerManifestId,
          composerVersion: MMR_SLATE_POLICY_VERSION,
          configDigest: f.protocol.configDigest,
          evidenceDigest: "a".repeat(64),
          reviewDigest: "b".repeat(64),
          authorityRevision: 1,
          cowatchGenerationId: graph.generationId,
        },
        slate: {
          ...candidateSlate,
          ordered: [
            {
              ...candidate,
              nominations: [wrongNomination],
              selectedNomination: wrongNomination,
            },
          ],
        },
        historyAvailable: true,
        deadlineMs: Date.now() + 2000,
        verifyStudyAuthority: async () => null,
        now: f.now,
      })
      expect(result).toMatchObject({
        status: "fallback",
        provenance: { reason: "composition_candidate_graph_mismatch" },
      })
    })
    it("rolls back observation publication for a nomination from a different graph", async () => {
      const graph = await compositionGraphFixture(db)
      await expect(
        fixture({ graph, wrongNominationGraph: true }),
      ).rejects.toThrow("composition nomination graph mismatch")
      const protocol =
        await db.recommendationCompositionProtocol.findFirstOrThrow({
          where: {
            config: {
              path: ["cowatchGenerationId"],
              equals: graph.generationId,
            },
          },
        })
      expect(
        await db.recommendationCompositionObservation.count({
          where: { protocolId: protocol.id },
        }),
      ).toBe(0)
    })
    it("refuses evidence when the evaluation pins a different graph", async () => {
      const graph = await compositionGraphFixture(db)
      const f = await fixture({ graph, evaluationGraphId: "0".repeat(64) })
      expect(
        await db.recommendationCompositionObservation.count({
          where: { protocolId: f.protocolId },
        }),
      ).toBe(0)
      await expect(
        decideCompositionProtocol(db, f.operator, f.protocolId, f.now),
      ).rejects.toThrow("composition_shadow_not_terminal")
    })
    it.each([
      "profile_generation",
      "source_deletion",
      "graph_deletion",
      "edge_append",
    ] as const)(
      "irreversibly revokes graph qualification after %s",
      async (mutation) => {
        const graph = await compositionGraphFixture(db)
        const f = await qualified({ graph })
        if (mutation === "profile_generation")
          await db.recommendationProfile.update({
            where: { id: graph.profileId },
            data: { privacyGeneration: 2 },
          })
        if (mutation === "source_deletion")
          await db.recommendationCowatchSourceContribution.deleteMany({
            where: { generationId: graph.generationId },
          })
        if (mutation === "graph_deletion")
          await db.recommendationCowatchGeneration.delete({
            where: { id: graph.generationId },
          })
        if (mutation === "edge_append") {
          const edge = await db.recommendationCowatchEdge.findFirstOrThrow({
            where: { generationId: graph.generationId },
          })
          await db.recommendationCowatchEdge.create({
            data: { ...edge, id: randomUUID(), targetMediaId: randomUUID() },
          })
        }
        expect(
          await resolveCompositionQualification(db, f.binding, f.now),
        ).toBeNull()
        expect(
          await resolveRetainedCompositionQualification(
            db,
            f.binding,
            new Date(f.now.getTime() + 86_400_000),
          ),
        ).toBeNull()
        await expect(
          recordCompositionCalibration(db, f.operator, f.reviewInput, f.now),
        ).rejects.toThrow("composition_evidence_revoked")
        const protocol =
          await db.recommendationCompositionProtocol.findUniqueOrThrow({
            where: { id: f.protocolId },
          })
        expect(protocol.revokedAt).not.toBeNull()
        expect(protocol.authorityRevision).toBeGreaterThan(1)
      },
    )
    it("fences graph append from preparation before trial qualification", async () => {
      const graph = await compositionGraphFixture(db)
      const now = graph.now
      const input = {
        protocolId: randomUUID(),
        shadowEvaluationId: randomUUID(),
        sourceManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
        challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
        generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
        cowatchGenerationId: graph.generationId,
        thresholds,
      }
      await prepareCompositionProtocol(
        db,
        { actor, authenticatedAt: now },
        input,
        now,
      )
      const edge = await db.recommendationCowatchEdge.findFirstOrThrow({
        where: { generationId: graph.generationId },
      })
      await db.recommendationCowatchEdge.create({
        data: { ...edge, id: randomUUID(), targetMediaId: randomUUID() },
      })
      const protocol =
        await db.recommendationCompositionProtocol.findUniqueOrThrow({
          where: { id: input.protocolId },
        })
      expect(protocol.revokedAt).not.toBeNull()
    })

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
      "nomination_delete",
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
        if (kind === "nomination_delete")
          await db.recommendationShadowNomination.deleteMany({
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
      expect(
        await resolveRetainedCompositionQualification(
          db,
          f.binding,
          new Date(f.now.getTime() - 1),
        ),
      ).toBeNull()
      await expect(
        db.recommendationStrategyManifest.update({
          where: { id: challengerId },
          data: { maxItems: 5 },
        }),
      ).rejects.toThrow("manifests are immutable")
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
    it.each([false, true])(
      "serves MMR with exact study authority, graph=%s",
      async (cowatch) => {
        const graph = cowatch ? await compositionGraphFixture(db) : undefined
        const f = await qualified({ graph })
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
          challengerManifestId: f.binding.manifestId,
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
              if (graph)
                await db.recommendationCowatchSourceContribution.deleteMany({
                  where: { generationId: graph.generationId },
                })
              else
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
      },
    )
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
    it.each([false, true])(
      "orders source erasure after exact issuance locks, graph=%s",
      async (cowatch) => {
        const graph = cowatch ? await compositionGraphFixture(db) : undefined
        const f = await qualified({ graph })
        let acquired!: () => void
        let release!: () => void
        const locked = new Promise<void>((resolve) => {
          acquired = resolve
        })
        const hold = new Promise<void>((resolve) => {
          release = resolve
        })
        const issuance = db.$transaction(async (tx) => {
          const qualification = await lockCompositionQualificationForIssuance(
            tx,
            f.binding,
            f.now,
          )
          acquired()
          await hold
          return qualification
        })
        await locked
        const deletion = (
          graph
            ? db.recommendationCowatchSourceContribution.deleteMany({
                where: { generationId: graph.generationId },
              })
            : db.recommendationRequest.delete({ where: { id: f.requestId } })
        ).then(() => "deleted")
        const table = graph
          ? "%recommendation_cowatch_source_contribution%"
          : "%recommendation_request%"
        try {
          await expect
            .poll(
              async () => {
                const rows = await db.$queryRaw<
                  Array<{ blocked: boolean }>
                >`SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query ILIKE '%DELETE%'
            AND query ILIKE ${table}
          ) AS blocked`
                return rows[0]?.blocked
              },
              { timeout: 1_000, interval: 10 },
            )
            .toBe(true)
        } finally {
          release()
        }
        expect(await issuance).not.toBeNull()
        expect(await deletion).toBe("deleted")
        expect(
          await db.$transaction((tx) =>
            lockCompositionQualificationForIssuance(tx, f.binding, f.now),
          ),
        ).toBeNull()
      },
    )
  },
)
