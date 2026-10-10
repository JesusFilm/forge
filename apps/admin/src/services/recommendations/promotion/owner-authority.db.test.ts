import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { compositionGraphFixture } from "../composition/graph.test-fixture"
import { seedOwnerDeliveryGraph } from "../delivery-owner.test-helper"
import { resolveDeliveryOwnerAuthority } from "../delivery-owner.service"
import { lockRetentionRoots } from "../retention-locks"
import {
  COWATCH_FROZEN_TRIAL_MODE,
  cowatchTrialBindingDigest,
  cowatchTrialBindingRecord,
  readCowatchTrialAuthority,
  type CowatchTrialBinding,
} from "../cowatch/trial-authority.service"
import {
  directDeliveryAuthorityDigest,
  lockOwnerReleaseForIssuance,
  prepareOwnerReleaseBinding,
  readActiveOwnerRelease,
} from "./owner-authority"

const day = 86_400_000
const enabled = env.RECOMMENDATION_DB_TEST === "1"

describe.skipIf(!enabled)("owner release authority on owned PostgreSQL", () => {
  let db: PrismaClient
  beforeAll(() => {
    const url = new URL(env.DATABASE_URL)
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname !== "/forge_owner_authority_test" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Dedicated loopback forge_owner_authority_test fixture required",
      )
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 4 }),
    })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })

  async function activate() {
    const graph = await compositionGraphFixture(db)
    const release = await db.$transaction(
      async (tx) => {
        const prepared = await prepareOwnerReleaseBinding(
          tx,
          { graphGenerationId: graph.generationId },
          graph.now,
        )
        const pointer =
          await tx.recommendationPromotionPointer.findUniqueOrThrow({
            where: { id: "recommendation-promotion-pointer" },
          })
        const row = await tx.recommendationOwnerRelease.create({
          data: {
            ...prepared,
            id: randomUUID(),
            pointerGeneration: pointer.generation + 1,
            approvedById: "owned-authority-fixture",
            approvedAt: prepared.qualifiedAt,
            expiresAt: new Date(prepared.qualifiedAt.getTime() + 2555 * day),
          },
        })
        await tx.recommendationPromotionPointer.update({
          where: { id: pointer.id },
          data: {
            generation: row.pointerGeneration,
            stage: "OWNER_APPROVED",
            exposureCeilingBps: 10_000,
            activeManifestId: row.manifestId,
            activeApprovalId: null,
            activeOwnerReleaseId: row.id,
            killSwitchEnabled: false,
          },
        })
        return row
      },
      { timeout: 30_000 },
    )
    const now = new Date(release.qualifiedAt.getTime() + 10)
    const authority = await readActiveOwnerRelease(db, now)
    if (!authority) throw new Error("Expected qualified fixture authority")
    return { graph, release, authority, now }
  }

  it("qualifies actual finite source rows without any study or evaluation and is immutable", async () => {
    const initialExperiments = await db.recommendationExperiment.count()
    const { graph, release, authority, now } = await activate()
    expect(authority.releaseId).toBe(release.id)
    expect(authority.validUntil.getTime()).toBe(
      new Date(authority.binding.publishedAt).getTime() + day,
    )
    expect(await db.recommendationStudy.count()).toBe(0)
    expect(await db.recommendationExperiment.count()).toBe(initialExperiments)
    expect(await db.recommendationShadowEvaluation.count()).toBe(0)
    expect(await db.recommendationCompositionProtocol.count()).toBe(0)
    await expect(
      db.recommendationOwnerRelease.update({
        where: { id: release.id },
        data: { validUntil: new Date(release.validUntil.getTime() + 1) },
      }),
    ).rejects.toThrow()
    await expect(
      db.$transaction((tx) =>
        prepareOwnerReleaseBinding(
          tx,
          { graphGenerationId: graph.generationId },
          now,
        ),
      ),
    ).rejects.toThrow("already_qualified")
    expect(directDeliveryAuthorityDigest(authority)).not.toBe(
      directDeliveryAuthorityDigest({
        ...authority,
        validUntil: new Date(authority.validUntil.getTime() + 1),
      }),
    )
  })

  it("uses a stable preparation digest but checks natural expiry on every live lookup", async () => {
    const graph = await compositionGraphFixture(db)
    const first = await db.$transaction((tx) =>
      prepareOwnerReleaseBinding(
        tx,
        { graphGenerationId: graph.generationId },
        graph.now,
      ),
    )
    const second = await db.$transaction((tx) =>
      prepareOwnerReleaseBinding(
        tx,
        { graphGenerationId: graph.generationId },
        new Date(graph.now.getTime() + 100),
      ),
    )
    expect(first.bindingDigest).toBe(second.bindingDigest)
    const current = await activate()
    expect(
      await readActiveOwnerRelease(db, current.release.validUntil),
    ).toBeNull()
  })

  it("refuses invalid identity and immutable source-window mutation", async () => {
    const graph = await compositionGraphFixture(db)
    await expect(
      db.$transaction((tx) =>
        prepareOwnerReleaseBinding(
          tx,
          {
            graphGenerationId: graph.generationId,
            manifestId: "semantic-profile-hybrid-v1",
          },
          graph.now,
        ),
      ),
    ).rejects.toThrow("manifest_invalid")
    await expect(
      db.$transaction((tx) =>
        prepareOwnerReleaseBinding(tx, { graphGenerationId: "bad" }, graph.now),
      ),
    ).rejects.toThrow("graph_invalid")
    await expect(
      db.recommendationCowatchGeneration.update({
        where: { id: graph.generationId },
        data: { windowStart: new Date(graph.now.getTime() - day) },
      }),
    ).rejects.toThrow()
  })

  it("revokes after profile reset and preserves the first revocation through graph deletion", async () => {
    const current = await activate()
    await db.recommendationProfile.update({
      where: { id: current.graph.profileId },
      data: { privacyGeneration: { increment: 1 } },
    })
    const invalidated = await db.recommendationOwnerRelease.findUniqueOrThrow({
      where: { id: current.release.id },
    })
    expect(invalidated.revokedAt).not.toBeNull()
    expect(await readActiveOwnerRelease(db, current.now)).toBeNull()
    await db.recommendationCowatchGeneration.delete({
      where: { id: current.graph.generationId },
    })
    const retained = await db.recommendationOwnerRelease.findUniqueOrThrow({
      where: { id: current.release.id },
    })
    expect(retained.revokedAt).toEqual(invalidated.revokedAt)
    expect(retained.revocationReason).toEqual(invalidated.revocationReason)
  })

  it("fences appended graph lineage and rejects same-ID resurrection", async () => {
    const current = await activate()
    const other = await compositionGraphFixture(db)
    const source =
      await db.recommendationCowatchSourceContribution.findFirstOrThrow({
        where: { generationId: other.generationId },
      })
    await db.recommendationCowatchSourceContribution.create({
      data: {
        ...source,
        id: randomUUID(),
        generationId: current.graph.generationId,
      },
    })
    expect(await readActiveOwnerRelease(db, current.now)).toBeNull()
    const original = await db.recommendationCowatchGeneration.findUniqueOrThrow(
      { where: { id: current.graph.generationId } },
    )
    await db.recommendationCowatchGeneration.delete({
      where: { id: original.id },
    })
    await db.recommendationCowatchGeneration.create({
      data: { ...original, invalidatedAt: null, invalidationReason: null },
    })
    await expect(
      db.$transaction((tx) =>
        prepareOwnerReleaseBinding(
          tx,
          { graphGenerationId: original.id },
          current.now,
        ),
      ),
    ).rejects.toThrow("already_qualified")
    expect(await readActiveOwnerRelease(db, current.now)).toBeNull()
  })

  it("locks the release in retention's graph closure before deleting raw roots", async () => {
    const current = await activate()
    await db.$transaction(
      async (tx) => {
        await lockRetentionRoots(tx, { graphIds: [current.graph.generationId] })
        await tx.recommendationCowatchGeneration.delete({
          where: { id: current.graph.generationId },
        })
      },
      { timeout: 10_000 },
    )
    expect(
      (
        await db.recommendationOwnerRelease.findUniqueOrThrow({
          where: { id: current.release.id },
        })
      ).revokedAt,
    ).not.toBeNull()
  })

  it("floor advancement fences cached direct and trial authority without a graph scan", async () => {
    const current = await activate()
    const binding: CowatchTrialBinding = {
      mode: COWATCH_FROZEN_TRIAL_MODE,
      studyId: randomUUID(),
      experimentGeneration: 1,
      protocolDigest: "a".repeat(64),
      manifestId: current.release.manifestId,
      manifestDigest: current.release.manifestDigest,
      graphGenerationId: current.graph.generationId,
      sourceWindow: {
        version: "episode-event-window-v1",
        windowStart: new Date(
          current.authority.binding.sourceWindow.windowStart,
        ),
        windowEnd: new Date(current.authority.binding.sourceWindow.windowEnd),
        evaluationAsOf: new Date(
          current.authority.binding.sourceWindow.evaluationAsOf,
        ),
      },
      calibrationCompletedAt: current.now,
      enrollmentEnd: new Date(current.now.getTime() + day),
      trialValidUntil: new Date(current.now.getTime() + day + 30 * 3_600_000),
      shadowEvaluationId: randomUUID(),
      shadowDecisionId: randomUUID(),
    }
    // Synthetic authority isolates the cached reader; it is never study evidence.
    await db.recommendationCowatchTrialAuthority.create({
      data: {
        generationId: current.graph.generationId,
        bindingDigest: cowatchTrialBindingDigest(binding),
        binding: cowatchTrialBindingRecord(binding),
        ownerInfluenceFloorGeneration:
          current.authority.binding.ownerInfluenceFloorGeneration,
        dependencyExpiresAt: current.release.dependencyExpiresAt,
        rawPopulationExpiresAt: current.release.rawPopulationExpiresAt,
        trialValidUntil: binding.trialValidUntil,
        qualifiedAt: current.now,
      },
    })
    expect(
      (await readCowatchTrialAuthority(db, binding, current.now)).status,
    ).toBe("current")
    const next = current.authority.pointerGeneration + 1
    await db.recommendationPromotionPointer.update({
      where: { id: "recommendation-promotion-pointer" },
      data: {
        generation: next,
        ownerInfluenceFloorGeneration: next,
        killSwitchEnabled: true,
      },
    })
    expect(await readActiveOwnerRelease(db, current.now)).toBeNull()
    expect(
      (await readCowatchTrialAuthority(db, binding, current.now)).status,
    ).toBe("refused")
    await expect(
      db.recommendationPromotionPointer.update({
        where: { id: "recommendation-promotion-pointer" },
        data: { ownerInfluenceFloorGeneration: 0 },
      }),
    ).rejects.toThrow()
  })

  it("does not let a valid graph bypass current requesting profile/receipt checks", async () => {
    const current = await activate()
    await expect(
      db.$transaction((tx) =>
        lockOwnerReleaseForIssuance(tx, {
          expected: current.authority,
          profileTokenDigest: "f".repeat(64),
          profileProjectionId: "missing",
          privacyGeneration: 1,
          consentReceiptDigest: "e".repeat(64),
          now: current.now,
        }),
      ),
    ).rejects.toThrow("profile_fenced")
  })

  it("fences a superseded profile source outside the selected graph after authority resolution", async () => {
    const current = await activate()
    // This profile is created after the selected graph was published. Its
    // positive source cannot be among that graph's immutable source rows.
    const source = await seedOwnerDeliveryGraph(db)
    const profile = await db.recommendationProfile.findUniqueOrThrow({
      where: { id: source.graph.profileId },
    })
    const input = {
      expected: current.authority,
      profileTokenDigest: profile.tokenDigest!,
      profileProjectionId: source.projection.id,
      privacyGeneration: profile.privacyGeneration,
      consentReceiptDigest: source.consentReceiptDigest,
      now: new Date(Math.max(current.now.getTime(), Date.now())),
    }
    expect(
      await resolveDeliveryOwnerAuthority(db, {
        ...input,
        deadlineAt: Date.now() + 5_000,
      }),
    ).not.toBeNull()
    expect(
      await db.recommendationCowatchSourceContribution.count({
        where: {
          generationId: current.graph.generationId,
          outcomeId: `${source.graph.episodes[0]}-r1`,
        },
      }),
    ).toBe(0)
    await db.recommendationEligibilityDecision.update({
      where: { id: `${source.graph.episodes[0]}-eligible` },
      data: { isCurrent: false },
    })
    expect(await readActiveOwnerRelease(db, input.now)).not.toBeNull()
    expect(
      (
        await db.recommendationProfileProjectionGeneration.findUniqueOrThrow({
          where: { id: source.projection.id },
        })
      ).state,
    ).toBe("PUBLISHED")
    await expect(
      db.$transaction((tx) => lockOwnerReleaseForIssuance(tx, input)),
    ).rejects.toThrow("profile_lineage_fenced")
  })

  it("holds exact profile source locks through commit and refuses concurrent source owners immediately", async () => {
    const current = await activate()
    const source = await seedOwnerDeliveryGraph(db)
    const profile = await db.recommendationProfile.findUniqueOrThrow({
      where: { id: source.graph.profileId },
    })
    const input = {
      expected: current.authority,
      profileTokenDigest: profile.tokenDigest!,
      profileProjectionId: source.projection.id,
      privacyGeneration: profile.privacyGeneration,
      consentReceiptDigest: source.consentReceiptDigest,
      now: new Date(Math.max(current.now.getTime(), Date.now())),
    }
    const decisionId = `${source.graph.episodes[0]}-eligible`
    await db.$transaction(
      async (tx) => {
        await lockOwnerReleaseForIssuance(tx, input)
        await expect(
          db.$transaction(async (concurrent) => {
            await concurrent.$executeRaw`SET LOCAL lock_timeout = '50ms'`
            await concurrent.recommendationEligibilityDecision.update({
              where: { id: decisionId },
              data: { isCurrent: false },
            })
          }),
        ).rejects.toThrow("canceling statement due to lock timeout")
        const outcome =
          await tx.recommendationOutcomeRevision.findUniqueOrThrow({
            where: { id: `${source.graph.episodes[0]}-r1` },
          })
        await expect(
          db.$transaction(async (concurrent) => {
            await concurrent.$executeRaw`SET LOCAL lock_timeout = '50ms'`
            await concurrent.recommendationOutcomeRevision.create({
              data: {
                ...outcome,
                activeIntervals: undefined,
                id: randomUUID(),
                supersedesId: outcome.id,
                revision: 2,
                inputDigest: "9".repeat(64),
                qualifiedView: false,
              },
            })
          }),
        ).rejects.toThrow("canceling statement due to lock timeout")
      },
      { timeout: 10_000 },
    )
    expect(
      (
        await db.recommendationEligibilityDecision.findUniqueOrThrow({
          where: { id: decisionId },
        })
      ).isCurrent,
    ).toBe(true)
    await db.$transaction(async (sourceOwner) => {
      await sourceOwner.$queryRaw`SELECT id FROM recommendation_eligibility_decision WHERE id = ${decisionId} FOR UPDATE`
      await expect(
        db.$transaction((tx) => lockOwnerReleaseForIssuance(tx, input)),
      ).rejects.toThrow("could not obtain lock")
    })
    await db.recommendationEligibilityDecision.update({
      where: { id: decisionId },
      data: { isCurrent: false },
    })
    await expect(
      db.$transaction((tx) => lockOwnerReleaseForIssuance(tx, input)),
    ).rejects.toThrow("profile_lineage_fenced")
  }, 15_000)
})
