import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RecommendationEpisodeService } from "./episode.service"
import { RecommendationPlaybackService } from "./playback.service"
import { RecommendationProfileService } from "./profile.service"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "./token.service"
import { loadViewingModeAffinity } from "./viewing-mode.service"

const root = new URL("../../../prisma/migrations/", import.meta.url)
const caller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "viewing mode profile and retrieval on PostgreSQL",
  () => {
    const schema = `viewing_mode_${randomUUID().replaceAll("-", "")}`
    const start = new Date()
    let now = new Date(start.getTime() + 40_000)
    let admin: Client
    let prisma: PrismaClient
    const keyring = parseRecommendationKeyring(
      JSON.stringify({
        keys: [
          {
            kid: "mode-test",
            status: "active",
            key: Buffer.alloc(32, 19).toString("base64url"),
          },
        ],
      }),
    )
    const token = {
      activeKid: keyring.active.kid,
      ...createRecommendationTokenService({
        keyring,
        readRevokedKids: async () => [],
        now: () => now,
      }),
    }

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const name of readdirSync(root)
        .filter(
          (name) =>
            (Number(name.slice(0, 4)) >= 52 &&
              Number(name.slice(0, 4)) <= 82 &&
              name.includes("recommendation")) ||
            name === "0082_user_recommendation_identity" ||
            name === "0098_recommendation_viewing_mode",
        )
        .sort()) {
        await admin.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      }
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: url.toString(),
            options: `-c search_path=${schema},public`,
          },
          { schema },
        ),
      })
    })
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    async function identity(index: number) {
      const digest = index.toString(16).padStart(64, "0")
      const profile = await prisma.recommendationProfile.create({
        data: {
          tokenDigest: digest,
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(start.getTime() + 86_400_000),
        },
      })
      await prisma.recommendationProfileSessionLink.create({
        data: {
          profileId: profile.id,
          privacyGeneration: 1,
          sessionDigest: digest,
          linkedAt: new Date(start.getTime() - 1_000),
          expiresAt: profile.expiresAt,
        },
      })
      return { profile, digest }
    }

    async function watch(digest: string, mediaId: string, seconds = 30) {
      now = start
      const episodes = new RecommendationEpisodeService({
        prisma,
        tokenService: token,
        now: () => now,
        newId: randomUUID,
        newClaimNonce: randomUUID,
      })
      const issued = await episodes.issueContext({
        caller,
        sessionDigest: digest,
        mediaId,
        discoverySource: "direct",
        provenance: { entry: "canonical" },
      })
      const claim = await episodes.claim({
        caller,
        sessionDigest: digest,
        mediaId,
        claimNonce: issued.claimNonce,
      })
      now = new Date(start.getTime() + 40_000)
      const input = {
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: claim.capability,
        episodeId: claim.episodeId,
        sessionDigest: digest,
        mediaId,
        events: [
          {
            eventId: "visible-muted",
            kind: "playback_viewing_mode",
            occurredAt: new Date(
              start.getTime() + seconds * 1_000,
            ).toISOString(),
            payload: {
              version: "sound-off-viewing-v1",
              mode: "sound_off",
              preview: true,
              activeMilliseconds: seconds * 1_000,
              fromSeconds: 0,
              toSeconds: seconds,
              durationSeconds: 120,
              playbackRate: 1,
            },
          },
        ],
      }
      const recorder = new RecommendationPlaybackService({
        prisma,
        tokenService: token,
        now: () => now,
        newId: randomUUID,
      })
      await recorder.record(input)
      return { claim, input, recorder }
    }

    it("feeds a durable mode preference and candidate performance from accepted preview facts", async () => {
      const viewer = await identity(1)
      const first = await watch(viewer.digest, "watched-one")
      await watch(viewer.digest, "watched-two")
      await watch(viewer.digest, "watched-three")
      await first.recorder.record(first.input)
      expect(
        await prisma.recommendationViewingModeEvidence.count({
          where: { profileId: viewer.profile.id },
        }),
      ).toBe(3)
      const evidence =
        await prisma.recommendationViewingModeEvidence.findUniqueOrThrow({
          where: { episodeId: first.claim.episodeId },
        })
      expect(evidence).toMatchObject({
        soundOffQualified: true,
        soundOnQualified: false,
        previewMilliseconds: 30_000,
        factWatermark: 1,
      })
      const load = () =>
        prisma.$transaction((tx) =>
          loadViewingModeAffinity(tx, {
            profileTokenDigest: viewer.digest,
            mediaIds: ["candidate"],
            now,
          }),
        )
      expect(await load()).toMatchObject({
        qualifiedVideos: 3,
        soundOffPreference: 1,
        confidence: 1,
        candidates: [],
      })
      for (let index = 2; index <= 21; index++) {
        const contributor = await identity(index)
        await watch(contributor.digest, "candidate", index <= 19 ? 30 : 3)
      }
      const mode = await load()
      expect(mode?.candidates).toEqual([
        {
          mediaId: "candidate",
          viewers: 20,
          qualifiedViewers: 18,
          affinity: expect.closeTo(2 * (20 / 24 - 0.5)),
        },
      ])
      // Conflicting replay invalidates an already materialized contribution.
      await first.recorder.record({
        ...first.input,
        events: [
          {
            ...first.input.events[0]!,
            payload: { ...first.input.events[0]!.payload, preview: false },
          },
        ],
      })
      expect(await load()).toMatchObject({ qualifiedVideos: 2 })
      // Erasure removes both profile-facing and aggregate performance influence.
      await new RecommendationProfileService({
        prisma,
        now: () => now,
      }).transition({
        caller,
        contractVersion: "recommendation-profile-v1",
        action: "withdraw",
        sessionDigest: viewer.digest,
        existingProfileDigest: viewer.digest,
        proposedProfileDigest: null,
      })
      expect(await load()).toBeNull()
      expect(
        await prisma.recommendationViewingModeEvidence.count({
          where: { profileId: viewer.profile.id },
        }),
      ).toBe(0)
      await first.recorder.record({
        ...first.input,
        events: [{ ...first.input.events[0]!, eventId: "after-withdrawal" }],
      })
      expect(
        await prisma.recommendationViewingModeEvidence.count({
          where: { profileId: viewer.profile.id },
        }),
      ).toBe(0)
    }, 30_000)

    it("does not attach an old playback to the replacement profile after reset", async () => {
      const viewer = await identity(30)
      const played = await watch(viewer.digest, "before-reset", 1)
      await new RecommendationProfileService({
        prisma,
        now: () => now,
      }).transition({
        caller,
        contractVersion: "recommendation-profile-v1",
        action: "reset",
        sessionDigest: viewer.digest,
        existingProfileDigest: viewer.digest,
        proposedProfileDigest: "f".repeat(64),
      })
      await played.recorder.record({
        ...played.input,
        events: [
          {
            ...played.input.events[0]!,
            eventId: "after-reset",
            occurredAt: new Date(start.getTime() + 30_000).toISOString(),
            payload: {
              ...played.input.events[0]!.payload,
              toSeconds: 30,
              activeMilliseconds: 30_000,
            },
          },
        ],
      })
      expect(
        await prisma.recommendationViewingModeEvidence.count({
          where: { episodeId: played.claim.episodeId },
        }),
      ).toBe(0)
    })

    it("serializes concurrent mode publication and deletion without resurrecting influence", async () => {
      const viewer = await identity(31)
      const played = await watch(viewer.digest, "concurrent-delete", 3)
      const results = await Promise.all([
        played.recorder.record({
          ...played.input,
          events: [
            {
              ...played.input.events[0]!,
              eventId: "concurrent-progress",
              occurredAt: new Date(start.getTime() + 30_000).toISOString(),
              payload: {
                ...played.input.events[0]!.payload,
                fromSeconds: 3,
                toSeconds: 30,
                activeMilliseconds: 27_000,
              },
            },
          ],
        }),
        new RecommendationProfileService({ prisma, now: () => now }).transition(
          {
            caller,
            contractVersion: "recommendation-profile-v1",
            action: "delete",
            sessionDigest: viewer.digest,
            existingProfileDigest: viewer.digest,
            proposedProfileDigest: null,
          },
        ),
      ])
      expect(results[0][0]?.status).toBe("accepted")
      expect(
        await prisma.recommendationViewingModeEvidence.count({
          where: { episodeId: played.claim.episodeId },
        }),
      ).toBe(0)
      expect(
        await prisma.recommendationPlaybackFact.count({
          where: { episodeId: played.claim.episodeId },
        }),
      ).toBe(2)
    })
  },
)
