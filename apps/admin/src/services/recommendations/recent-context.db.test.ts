import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  getRecommendationRecentContext,
  MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION,
} from "./recent-context.service"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "current-session recent context on PostgreSQL",
  () => {
    let db: PrismaClient
    const prefix = randomUUID()
    const session = "a".repeat(32) + prefix.replaceAll("-", "")
    const otherSession = "b".repeat(64)
    const manifestId = `recent-context-${prefix}`
    const now = new Date()
    const future = new Date(now.getTime() + 86_400_000)
    const recent = new Date(now.getTime() - 60_000)
    const videoId = `recent-video-${prefix}`
    const ownedRequestIds: string[] = []
    const ownedEpisodeIds: string[] = []

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
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 6,
        },
      })
      await db.$executeRawUnsafe(
        `INSERT INTO video (id, core_id, slug, updated_at) VALUES ($1, $2, $3, now())`,
        videoId,
        videoId,
        videoId,
      )
      await db.$executeRawUnsafe(
        `INSERT INTO video_locale (id, video_id, locale, title, updated_at)
         VALUES ($1, $2, 'en', 'Recent title', now()),
                ($3, $2, 'fr', 'Titre récent', now())`,
        `${prefix}-en`,
        videoId,
        `${prefix}-fr`,
      )
    })

    afterAll(async () => {
      if (!db) return
      await db.recommendationRequest.deleteMany({
        where: { id: { in: ownedRequestIds } },
      })
      await db.recommendationPlaybackEpisode.deleteMany({
        where: { id: { in: ownedEpisodeIds } },
      })
      await db.$executeRawUnsafe(`DELETE FROM video WHERE id = $1`, videoId)
      await db.$disconnect()
    })

    async function request(
      id: string,
      sessionDigest: string,
      createdAt: Date,
      mediaId: string,
    ) {
      ownedRequestIds.push(id)
      await db.recommendationRequest.create({
        data: {
          id,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: manifestId,
          classifierVersion: "active-watch-proxy-v1",
          sessionDigest,
          seedMediaId: "seed",
          locale: "en",
          expectedItemCount: 1,
          state: "ISSUED",
          result: "SERVED",
          issuedAt: createdAt,
          signingKid: "fixture",
          deliveryJti: `${id}-delivery`,
          createdAt,
          expiresAt: future,
          items: {
            create: {
              id: `${id}-item`,
              position: 0,
              targetMediaId: mediaId,
              canonicalHref: `/watch/${mediaId}`,
              candidateGenerator: "semantic",
              candidateProvenance: {},
              createdAt,
              expiresAt: future,
            },
          },
        },
      })
    }

    const read = (sessionDigest = session, locale = "en") =>
      getRecommendationRecentContext(db, {
        sessionDigest,
        profileTokenDigest: "c".repeat(64),
        allowDurableProfileLinks: true,
        locale,
        now,
      })

    it("limits to newest current-session roots and never reads another session", async () => {
      for (
        let index = 0;
        index < MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION + 2;
        index += 1
      ) {
        await request(
          `${prefix}-current-${index}`,
          session,
          new Date(
            recent.getTime() -
              (MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION + 2 - index) * 1000,
          ),
          index < 2 ? `${prefix}-old` : videoId,
        )
      }
      await request(
        `${prefix}-other-1`,
        otherSession,
        recent,
        `${prefix}-other-video`,
      )
      await request(
        `${prefix}-other-2`,
        otherSession,
        new Date(recent.getTime() - 1000),
        `${prefix}-other-video`,
      )
      await request(
        `${prefix}-future`,
        session,
        new Date(now.getTime() + 1000),
        `${prefix}-future-video`,
      )
      const context = await read()
      expect(context.videos).toEqual([
        {
          targetMediaId: videoId,
          videoCoreId: videoId,
          videoTitle: "Recent title",
          reasonCodes: ["repeatedly_served"],
        },
      ])
      expect((await read(session, "fr")).videos[0]?.videoTitle).toBe(
        "Titre récent",
      )
      expect((await read(otherSession)).videos).toEqual([
        {
          targetMediaId: `${prefix}-other-video`,
          reasonCodes: ["repeatedly_served"],
        },
      ])
      expect(
        context.videos.some(
          (video) => video.targetMediaId === `${prefix}-other-video`,
        ),
      ).toBe(false)
    })

    it("includes accepted current-session playback facts with server-time recency", async () => {
      const episodeId = `${prefix}-episode`
      ownedEpisodeIds.push(episodeId)
      await db.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          mediaId: `${prefix}-played`,
          sessionDigest: session,
          state: "CLAIMED",
          discoverySource: "direct",
          claimedAt: recent,
          activeUntil: new Date(recent.getTime() + 5 * 60_000),
          hardUntil: new Date(recent.getTime() + 6 * 60 * 60_000),
          createdAt: recent,
          expiresAt: future,
          facts: {
            create: [
              {
                id: `${episodeId}-start`,
                capabilityJti: `${prefix}-start`,
                eventId: `${prefix}-start`,
                payloadDigest: "d".repeat(64),
                sequence: 1,
                kind: "playback_start",
                occurredAt: recent,
                receivedAt: recent,
                expiresAt: future,
              },
              {
                id: `${episodeId}-active`,
                capabilityJti: `${prefix}-active`,
                eventId: `${prefix}-active`,
                payloadDigest: "e".repeat(64),
                sequence: 2,
                kind: "playback_active_visible_playing",
                payload: { activeMilliseconds: 4000 },
                occurredAt: new Date(now.getTime() + 120_000),
                receivedAt: recent,
                expiresAt: future,
              },
            ],
          },
        },
      })
      const context = await read()
      expect(context.videos).toEqual(
        expect.arrayContaining([
          {
            targetMediaId: `${prefix}-played`,
            reasonCodes: ["recently_tried"],
          },
        ]),
      )
      expect(
        (await read(otherSession)).videos.some(
          (video) => video.targetMediaId === `${prefix}-played`,
        ),
      ).toBe(false)
    })
  },
)
