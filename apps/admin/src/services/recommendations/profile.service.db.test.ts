import { readdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RecommendationEvidenceService } from "./evidence.service"
import { RecommendationBindingError } from "./errors"
import { RecommendationProfileService } from "./profile.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const recommendationMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return ordinal >= 52 && ordinal <= 71 && name.includes("recommendation")
  })
  .sort()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )

const webCaller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

async function waitForBlockedRecommendationQuery(
  client: Client,
  minimumCount: number,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND datname = current_database()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query LIKE '%recommendation_profile%'`,
    )
    if (Number(result.rows[0]?.count ?? 0) >= minimumCount) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `Timed out waiting for ${minimumCount} blocked recommendation query(s)`,
  )
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "recommendation profile concurrency against Postgres",
  () => {
    const schema = `recommendation_profile_concurrency_${Date.now()}`
    const now = new Date("2026-08-30T12:00:00.000Z")
    const sessionDigest = "1".repeat(64)
    const firstProfileDigest = "a".repeat(64)
    const secondProfileDigest = "b".repeat(64)
    const firstConsentDigest = "c".repeat(64)
    const secondConsentDigest = "d".repeat(64)
    let admin: Client
    let adminConnected = false
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      adminConnected = true
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of recommendationMigrations) {
        await admin.query(migration)
      }
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (adminConnected) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("serializes stale-cookie grants and lets withdrawal fence the only profile", async () => {
      const service = new RecommendationProfileService({
        prisma,
        now: () => now,
        newId: randomUUID,
        newAuditId: randomUUID,
      })
      const transition = (
        proposedProfileDigest: string,
        proposedConsentReceiptDigest: string,
      ) =>
        service.transition({
          caller: webCaller,
          contractVersion: "recommendation-profile-v1",
          consentContractVersion: "recommendation-consent-v1",
          action: "grant",
          consentChoice: "personalization",
          sessionDigest,
          existingConsentReceiptDigest: null,
          proposedConsentReceiptDigest,
          existingProfileDigest: null,
          proposedProfileDigest,
        })

      const grants = await Promise.all([
        transition(firstProfileDigest, firstConsentDigest),
        transition(secondProfileDigest, secondConsentDigest),
      ])
      expect(grants.every((grant) => grant.state === "active")).toBe(true)

      const [profiles, links, grantsRecorded, activeReceipts] =
        await Promise.all([
          prisma.recommendationProfile.findMany(),
          prisma.recommendationProfileSessionLink.findMany(),
          prisma.recommendationConsentTransition.count({
            where: { kind: "GRANT" },
          }),
          prisma.recommendationConsentReceipt.findMany({
            where: { state: "ACTIVE", choice: "PERSONALIZATION" },
          }),
        ])
      expect(profiles).toHaveLength(1)
      expect(links).toHaveLength(1)
      expect(grantsRecorded).toBe(1)
      expect(activeReceipts).toHaveLength(1)

      const activeProfile = profiles[0]!
      const activeConsent = activeReceipts[0]!
      await service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "withdraw",
        consentChoice: "essential_only",
        sessionDigest,
        existingConsentReceiptDigest: activeConsent.tokenDigest,
        proposedConsentReceiptDigest: "e".repeat(64),
        existingProfileDigest: activeProfile.tokenDigest,
        proposedProfileDigest: null,
      })

      await expect(
        Promise.all([
          prisma.recommendationProfile.count({ where: { state: "ACTIVE" } }),
          prisma.recommendationProfileSessionLink.count(),
          prisma.recommendationConsentReceipt.count({
            where: { state: "ACTIVE", choice: "PERSONALIZATION" },
          }),
        ]),
      ).resolves.toEqual([0, 0, 0])
    })

    it("allows only one reset across two sessions linked to one profile", async () => {
      const service = new RecommendationProfileService({
        prisma,
        now: () => now,
        newId: randomUUID,
        newAuditId: randomUUID,
      })
      const firstSession = "2".repeat(64)
      const secondSession = "3".repeat(64)
      const originalDigest = "f".repeat(64)
      const original = await service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        action: "grant",
        sessionDigest: firstSession,
        existingProfileDigest: null,
        proposedProfileDigest: originalDigest,
      })
      expect(original.state).toBe("active")
      await service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        action: "grant",
        sessionDigest: secondSession,
        existingProfileDigest: originalDigest,
        proposedProfileDigest: null,
      })

      const reset = (session: string, digest: string) =>
        service.transition({
          caller: webCaller,
          contractVersion: "recommendation-profile-v1",
          action: "reset",
          sessionDigest: session,
          existingProfileDigest: originalDigest,
          proposedProfileDigest: digest,
        })
      const resets = await Promise.allSettled([
        reset(firstSession, "8".repeat(64)),
        reset(secondSession, "9".repeat(64)),
      ])

      expect(
        resets.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1)
      expect(resets.filter(({ status }) => status === "rejected")).toHaveLength(
        1,
      )
      await expect(
        Promise.all([
          prisma.recommendationProfile.count({ where: { state: "ACTIVE" } }),
          prisma.recommendationConsentTransition.count({
            where: { kind: "RESET" },
          }),
        ]),
      ).resolves.toEqual([1, 1])
    })

    it("waits behind withdrawal fencing and rejects personalized evidence after the profile is revoked", async () => {
      const profileService = new RecommendationProfileService({
        prisma,
        now: () => now,
        newId: randomUUID,
        newAuditId: randomUUID,
      })
      const evidenceSessionDigest = "4".repeat(64)
      const profileDigest = "5".repeat(64)
      const grant = await profileService.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        action: "grant",
        sessionDigest: evidenceSessionDigest,
        existingProfileDigest: null,
        proposedProfileDigest: profileDigest,
      })
      expect(grant).toMatchObject({
        state: "active",
        privacyGeneration: 1,
      })
      expect(grant.profileId).not.toBeNull()

      const expiresAt = new Date(now.getTime() + 86_400_000)
      await admin.query(
        `INSERT INTO recommendation_experiment (
          id, experiment_version, surface_version, control_manifest_id,
          challenger_manifest_id, assignment_policy_version,
          outcome_policy_version, integrity_policy_version,
          evaluation_policy_version, configuration_digest,
          challenger_probability, state, generation, starts_at, ends_at,
          expires_at
        ) VALUES (
          'profile-fence-experiment', 'profile-fence-experiment-v1',
          'watch-below-player-v1', 'multi-interest-profile-shadow-v1',
          'multi-interest-profile-shadow-v1', 'deterministic-profile-v1',
          'active-watch-proxy-v1', 'recommendation-integrity-v1',
          'profile-fence-evaluation-v1', $1, 0.5, 'active', 1,
          $2, $3, $3
        )`,
        ["6".repeat(64), new Date(now.getTime() - 60_000), expiresAt],
      )
      await admin.query(
        `INSERT INTO recommendation_experiment_assignment (
          id, experiment_id, unit_kind, unit_digest, profile_id,
          privacy_generation, arm, assignment_probability,
          configuration_digest, state, generation, assigned_at, expires_at
        ) VALUES (
          'profile-fence-assignment', 'profile-fence-experiment',
          'anonymous_profile', $1, $2, 1, 'challenger', 0.5,
          $3, 'active', 1, $4, $5
        )`,
        ["7".repeat(64), grant.profileId, "6".repeat(64), now, expiresAt],
      )
      await admin.query("BEGIN")
      await admin.query(
        `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, state, result,
          delivery_jti, signing_kid, created_at, issued_at, expires_at,
          experiment_assignment_id
        ) VALUES (
          'profile-fence-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'multi-interest-profile-shadow-v1',
          'multi-interest-profile-shadow-v1', 'active-watch-proxy-v1',
          $1, 'profile-fence-seed', 'en', 1, 'prepared', 'served',
          'profile-fence-delivery-jti', 'test-kid', $2, $2, $3,
          'profile-fence-assignment'
        )`,
        [evidenceSessionDigest, now, expiresAt],
      )
      await admin.query(
        `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, presentation,
          capability_jti, signing_kid, expires_at
        ) VALUES (
          'profile-fence-item', 'profile-fence-request', 0,
          'profile-fence-target', '/watch/profile-fence-target.html',
          'multi-interest-profile', '{}'::jsonb, '{}'::jsonb,
          'profile-fence-capability-jti', 'test-kid', $1
        )`,
        [expiresAt],
      )
      await admin.query(
        `UPDATE recommendation_request
         SET state = 'issued'
         WHERE id = 'profile-fence-request'`,
      )
      await admin.query("COMMIT")

      const evidenceService = new RecommendationEvidenceService({
        prisma,
        now: () => now,
        tokenService: {
          verifyDeliveryCapability: async () => ({
            iat: Math.floor(now.getTime() / 1_000) - 60,
            exp: Math.floor(expiresAt.getTime() / 1_000),
          }),
        },
      })
      const blocker = new Client({ connectionString: env.DATABASE_URL })
      await blocker.connect()
      await blocker.query(`SET search_path TO "${schema}", public`)
      await blocker.query("BEGIN")
      await blocker.query(
        `SELECT id FROM recommendation_profile WHERE id = $1 FOR UPDATE`,
        [grant.profileId],
      )

      let blockerReleased = false
      try {
        const withdrawal = profileService.transition({
          caller: webCaller,
          contractVersion: "recommendation-profile-v1",
          action: "withdraw",
          sessionDigest: evidenceSessionDigest,
          existingProfileDigest: profileDigest,
          proposedProfileDigest: null,
        })
        await waitForBlockedRecommendationQuery(admin, 1)

        const evidence = evidenceService.record({
          caller: webCaller,
          contractVersion: "recommendation-evidence-v1",
          capability: "profile-fence-capability",
          requestId: "profile-fence-request",
          itemId: "profile-fence-item",
          sessionDigest: evidenceSessionDigest,
          events: [
            {
              eventId: "profile-fence-render",
              kind: "render",
              occurredAt: now.toISOString(),
              payload: {},
            },
          ],
        })
        await waitForBlockedRecommendationQuery(admin, 2)
        await blocker.query("COMMIT")
        blockerReleased = true

        await expect(withdrawal).resolves.toMatchObject({
          state: "session_only",
          cookieDisposition: "clear",
        })
        await expect(evidence).rejects.toBeInstanceOf(
          RecommendationBindingError,
        )
      } finally {
        if (!blockerReleased) await blocker.query("ROLLBACK")
        await blocker.end()
      }

      await expect(
        Promise.all([
          prisma.recommendationProfile.count({
            where: { id: grant.profileId!, state: "ACTIVE" },
          }),
          prisma.recommendationExperimentAssignment.count({
            where: { id: "profile-fence-assignment", state: "FENCED" },
          }),
          prisma.recommendationRenderedFact.count({
            where: { itemId: "profile-fence-item" },
          }),
        ]),
      ).resolves.toEqual([0, 1, 0])
    }, 15_000)
  },
)
