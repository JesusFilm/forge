import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  issueWatchSurfaceDelivery,
  recordWatchSurfaceExposureBatch,
} from "../watch-surface-exposure.service"
import {
  loadAnonymousWatchExposureBreakdown,
  loadWatchExposureBreakdown,
} from "./watch-exposure.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
function observedPrisma(url: string) {
  return new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: "event", level: "query" }],
  })
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch exposure SQL window reconciliation",
  () => {
    const schema = `watch_exposure_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let prisma: ReturnType<typeof observedPrisma>
    let admin: Client | null = null
    const queries: string[] = []
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      await admin.query(`
      CREATE TABLE watch_surface_exposure (
        id text PRIMARY KEY,
        event_id uuid UNIQUE NOT NULL,
        window_id uuid NOT NULL,
        surface varchar(40) NOT NULL,
        block varchar(40) NOT NULL,
        presentation varchar(40) NOT NULL,
        placement varchar(64) NOT NULL,
        policy_version varchar(40) NOT NULL,
        position integer NOT NULL,
        item_path varchar(512) NOT NULL,
        kind varchar(16) NOT NULL,
        visibility_capability varchar(32),
        duplicate_count integer NOT NULL DEFAULT 0,
        occurred_at timestamp(3) NOT NULL,
        received_at timestamp(3) NOT NULL DEFAULT now(),
        expires_at timestamp(3) NOT NULL
      )
    `)
      await admin.query(`CREATE UNIQUE INDEX watch_surface_exposure_served_item_key
        ON watch_surface_exposure (window_id, position, item_path) WHERE kind = 'served'`)
      await admin.query(`ALTER TABLE watch_surface_exposure ADD CONSTRAINT watch_surface_exposure_kind_check
        CHECK (kind IN ('rendered', 'eligible', 'selected') OR
          (kind = 'served' AND policy_version = 'watch-exposure-v2' AND visibility_capability IS NULL))`)
      await admin.query(`
      CREATE INDEX watch_surface_exposure_window_item_idx
      ON watch_surface_exposure
      (window_id, surface, block, presentation, placement, position, item_path, kind)
    `)
      await admin.query(`CREATE INDEX watch_surface_exposure_aggregate_idx
        ON watch_surface_exposure (surface, block, presentation, position, occurred_at)`)
      await admin.query(`CREATE INDEX watch_surface_exposure_window_cohort_idx
        ON watch_surface_exposure (occurred_at, window_id)`)
      await admin.query(`CREATE INDEX watch_surface_exposure_expiry_idx
        ON watch_surface_exposure (expires_at)`)
      await admin.query(`
        CREATE TABLE recommendation_request (id text PRIMARY KEY, surface_version text NOT NULL, created_at timestamp(3) NOT NULL);
        CREATE TABLE recommendation_served_item (id text PRIMARY KEY, request_id text NOT NULL, position integer NOT NULL);
        CREATE TABLE recommendation_rendered_fact (id text PRIMARY KEY, item_id text NOT NULL, received_at timestamp(3) NOT NULL);
        CREATE TABLE recommendation_impression (id text PRIMARY KEY, item_id text NOT NULL, received_at timestamp(3) NOT NULL, occurred_at timestamp(3) NOT NULL, visibility_capability text);
        CREATE TABLE recommendation_selection (id text PRIMARY KEY, item_id text NOT NULL, received_at timestamp(3) NOT NULL, occurred_at timestamp(3) NOT NULL);
      `)
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schema)
      prisma = observedPrisma(fixtureUrl.toString())
      prisma.$on("query", (event) => queries.push(event.query))
    })
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("does not turn a prior-window impression or repeat into this window's denominator", async () => {
      const start = new Date(Date.now() - 86_400_000)
      const at = (offsetMs: number) => new Date(start.getTime() + offsetMs)
      const insert = async (
        id: number,
        windowId: string,
        kind: "eligible" | "selected",
        occurredAt: Date,
        duplicateCount = 0,
      ) => {
        await prisma.$executeRaw`
        INSERT INTO watch_surface_exposure
          (id, event_id, window_id, surface, block, presentation, placement,
           policy_version, position, item_path, kind, visibility_capability,
           duplicate_count, occurred_at, received_at, expires_at)
        VALUES
          (${String(id)}, ${`00000000-0000-4000-8000-${String(id).padStart(12, "0")}`}::uuid,
           ${windowId}::uuid, 'watch-search', 'results', 'result-list', 'search-results',
           'watch-exposure-v1', 0, '/watch/example.html', ${kind},
           ${kind === "eligible" ? "unknown" : null}, ${duplicateCount},
           ${occurredAt}, ${occurredAt}, ${at(29 * 86_400_000)})
      `
      }
      const earlyWindow = "00000000-0000-4000-8000-000000000100"
      const normalWindow = "00000000-0000-4000-8000-000000000200"
      const repeatWindow = "00000000-0000-4000-8000-000000000300"
      await insert(1, earlyWindow, "eligible", at(-60_000))
      await insert(2, earlyWindow, "selected", at(60_000))
      await insert(3, normalWindow, "eligible", at(120_000))
      await insert(4, normalWindow, "selected", at(180_000))
      await insert(5, repeatWindow, "eligible", at(240_000), 1)
      await insert(6, repeatWindow, "eligible", at(300_000))
      await insert(7, repeatWindow, "selected", at(360_000))

      const rows = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
      expect(rows.rows).toHaveLength(1)
      expect(rows.truncated).toBe(false)
      expect(rows.rows[0]).toMatchObject({
        eligible: 2,
        selected: 3,
        eligibleSelected: 2,
        selectionWithoutImpression: 1,
        repeats: 1,
        ctr: 1,
        duplicateRate: 1 / 7,
      })
    })

    it("reconciles issued-only cards, concurrent issuance, exact bindings and early selections", async () => {
      const caller = {
        id: "forge-web",
        role: "CONSUMER_BEARER" as const,
        rateLimitBucketKey: "forge-web",
      }
      const now = new Date()
      const manifest = {
        surface: "watch-home",
        block: "hero",
        presentation: "hero-card",
        placement: "hero-primary",
        policyVersion: "watch-exposure-v2",
        sourceVersion: "c".repeat(64),
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
        items: [
          { position: 0, itemPath: "/watch/served-only.html" },
          { position: 0, itemPath: "/watch/early-select.html" },
        ],
      }
      const input = {
        manifest,
        attemptId: randomUUID(),
        trafficCategory: "ordinary_browser",
      }
      const receipts = await Promise.all([
        issueWatchSurfaceDelivery(prisma, caller, input, now),
        issueWatchSurfaceDelivery(prisma, caller, input, now),
      ])
      expect(receipts.map(({ status }) => status).sort()).toEqual([
        "accepted",
        "replay",
      ])
      expect(receipts[0].windowId).toEqual(receipts[1].windowId)
      expect(
        await issueWatchSurfaceDelivery(
          prisma,
          caller,
          {
            ...input,
            manifest: { ...manifest, sourceVersion: "d".repeat(64) },
          },
          now,
        ),
      ).toMatchObject({ status: "conflict" })
      const beforeCount = await prisma.watchSurfaceExposure.count()
      expect(
        await issueWatchSurfaceDelivery(
          prisma,
          caller,
          {
            ...input,
            attemptId: randomUUID(),
            trafficCategory: "declared_crawler",
          },
          now,
        ),
      ).toMatchObject({ disposition: "contextual", windowId: null })
      expect(await prisma.watchSurfaceExposure.count()).toBe(beforeCount)
      const fact = {
        eventId: randomUUID(),
        windowId: receipts[0].windowId!,
        surface: manifest.surface,
        block: manifest.block,
        presentation: manifest.presentation,
        placement: manifest.placement,
        policyVersion: manifest.policyVersion,
        ...manifest.items[1],
        kind: "selected",
        visibilityCapability: null,
        occurredAt: new Date(now.getTime() - 500).toISOString(),
      }
      expect(
        await recordWatchSurfaceExposureBatch(prisma, caller, [fact], now),
      ).toMatchObject([{ status: "accepted" }])
      await expect(
        recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [
            {
              ...fact,
              eventId: randomUUID(),
              itemPath: "/watch/not-issued.html",
            },
          ],
          now,
        ),
      ).rejects.toThrow("issued served binding")
      const report = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
      expect(
        report.rows.find((row) => row.policyVersion === "watch-exposure-v2"),
      ).toMatchObject({
        served: 2,
        rendered: 0,
        eligible: 0,
        selected: 1,
        selectionWithoutImpression: 1,
        ctr: null,
        duplicateRate: 0,
      })
      expect(
        await prisma.watchSurfaceExposure.count({
          where: { windowId: fact.windowId, kind: "served" },
        }),
      ).toBe(2)
      const inheritedExpiry = new Date(now.getTime() + 60_000)
      await prisma.watchSurfaceExposure.updateMany({
        where: { windowId: fact.windowId, kind: "served" },
        data: { expiresAt: inheritedExpiry },
      })
      const lateEvent = { ...fact, eventId: randomUUID() }
      await recordWatchSurfaceExposureBatch(prisma, caller, [lateEvent], now)
      expect(
        (
          await prisma.watchSurfaceExposure.findUniqueOrThrow({
            where: { eventId: lateEvent.eventId },
          })
        ).expiresAt,
      ).toEqual(inheritedExpiry)
      await prisma.watchSurfaceExposure.updateMany({
        where: { windowId: fact.windowId, kind: "served" },
        data: { expiresAt: new Date(now.getTime() - 1) },
      })
      await expect(
        recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [{ ...fact, eventId: randomUUID() }],
          now,
        ),
      ).rejects.toThrow("issued served binding")
      await expect(
        prisma.watchSurfaceExposure.create({
          data: {
            id: randomUUID(),
            ...fact,
            eventId: randomUUID(),
            kind: "served",
            policyVersion: "watch-exposure-v1",
            occurredAt: now,
            expiresAt: new Date(now.getTime() + 86_400_000),
          },
        }),
      ).rejects.toThrow()
    })

    it("persists 64-card batches in bounded queries and preserves concurrent replay", async () => {
      const caller = {
        id: "forge-web",
        role: "CONSUMER_BEARER" as const,
        rateLimitBucketKey: "forge-web",
      }
      const now = new Date()
      const elapsedMs: number[] = []
      const queryCounts: number[] = []
      for (let run = 0; run < 5; run += 1) {
        const windowId = randomUUID()
        const events = Array.from({ length: 64 }, (_, position) => ({
          eventId: randomUUID(),
          windowId,
          surface: "watch-search",
          block: "results",
          presentation: "result-list",
          placement: "search-results",
          policyVersion: "watch-exposure-v1",
          position,
          itemPath: `/watch/batch-${run}-${position}.html`,
          kind: "rendered",
          visibilityCapability: null,
          occurredAt: now.toISOString(),
        }))
        queries.length = 0
        const start = performance.now()
        const receipts = await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          events,
          now,
        )
        elapsedMs.push(Math.round(performance.now() - start))
        await new Promise((resolve) => setTimeout(resolve, 0))
        queryCounts.push(
          queries.filter((query) => query.includes("watch_surface_exposure"))
            .length,
        )
        expect(receipts.map(({ status }) => status)).toEqual(
          Array(64).fill("accepted"),
        )
      }
      expect(queryCounts).toEqual(Array(5).fill(2))
      console.info(
        `watch exposure 64-card ingest: elapsedMs=${elapsedMs.join(",")} queries=${queryCounts.join(",")}`,
      )

      const raceEvent = {
        eventId: randomUUID(),
        windowId: randomUUID(),
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        policyVersion: "watch-exposure-v1",
        position: 0,
        itemPath: "/watch/concurrent.html",
        kind: "rendered",
        visibilityCapability: null,
        occurredAt: now.toISOString(),
      }
      const concurrent = await Promise.all([
        recordWatchSurfaceExposureBatch(prisma, caller, [raceEvent], now),
        recordWatchSurfaceExposureBatch(prisma, caller, [raceEvent], now),
      ])
      expect(
        concurrent
          .flat()
          .map(({ status }) => status)
          .sort(),
      ).toEqual(["accepted", "replay"])
      expect(
        (
          await prisma.watchSurfaceExposure.findUniqueOrThrow({
            where: { eventId: raceEvent.eventId },
          })
        ).duplicateCount,
      ).toBe(1)
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [{ ...raceEvent, itemPath: "/watch/conflict.html" }],
          now,
        ),
      ).toEqual([{ eventId: raceEvent.eventId, status: "conflict" }])
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [
            {
              ...raceEvent,
              eventId: randomUUID(),
              occurredAt: new Date(now.getTime() + 1000).toISOString(),
            },
          ],
          now,
        ),
      ).toMatchObject([{ status: "repeat" }])

      const withinBatch = {
        ...raceEvent,
        eventId: randomUUID(),
        windowId: randomUUID(),
        itemPath: "/watch/within-batch.html",
      }
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [
            withinBatch,
            withinBatch,
            { ...withinBatch, itemPath: "/watch/other.html" },
          ],
          now,
        ),
      ).toEqual([
        { eventId: withinBatch.eventId, status: "accepted" },
        { eventId: withinBatch.eventId, status: "replay" },
        { eventId: withinBatch.eventId, status: "conflict" },
      ])
    })
    it("does not borrow eligibility across policy, position, path or receipt cutoff", async () => {
      await prisma.watchSurfaceExposure.deleteMany()
      const now = new Date()
      const at = (seconds: number) => new Date(now.getTime() + seconds * 1000)
      const windowId = randomUUID()
      const base = {
        windowId,
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        policyVersion: "watch-exposure-v1",
        position: 0,
        itemPath: "/watch/shared.html",
        visibilityCapability: null,
        receivedAt: at(-10),
        expiresAt: at(29 * 86400),
      }
      await prisma.watchSurfaceExposure.createMany({
        data: [
          { kind: "eligible", occurredAt: at(-50) },
          { kind: "selected", occurredAt: at(-40) },
          {
            kind: "selected",
            occurredAt: at(-40),
            itemPath: "/watch/other.html",
          },
          {
            kind: "served",
            occurredAt: at(-60),
            policyVersion: "watch-exposure-v2",
          },
          {
            kind: "selected",
            occurredAt: at(-40),
            policyVersion: "watch-exposure-v2",
          },
          { kind: "eligible", occurredAt: at(-40), position: 1 },
          { kind: "selected", occurredAt: at(-50), position: 1 },
          {
            kind: "eligible",
            occurredAt: at(-50),
            position: 2,
            receivedAt: at(3600),
          },
          { kind: "selected", occurredAt: at(-40), position: 2 },
        ].map((fact) => ({
          ...base,
          id: randomUUID(),
          eventId: randomUUID(),
          ...fact,
        })),
      })
      const report = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
      expect(report.rows).toHaveLength(4)
      expect(
        report.rows.map(
          ({
            policyVersion,
            position,
            served,
            eligible,
            selected,
            eligibleSelected,
            selectionWithoutImpression,
          }) => ({
            policyVersion,
            position,
            served,
            eligible,
            selected,
            eligibleSelected,
            selectionWithoutImpression,
          }),
        ),
      ).toEqual([
        {
          policyVersion: "watch-exposure-v1",
          position: 0,
          served: null,
          eligible: 1,
          selected: 2,
          eligibleSelected: 1,
          selectionWithoutImpression: 1,
        },
        {
          policyVersion: "watch-exposure-v2",
          position: 0,
          served: 1,
          eligible: 0,
          selected: 1,
          eligibleSelected: 0,
          selectionWithoutImpression: 1,
        },
        {
          policyVersion: "watch-exposure-v1",
          position: 1,
          served: null,
          eligible: 1,
          selected: 1,
          eligibleSelected: 0,
          selectionWithoutImpression: 1,
        },
        {
          policyVersion: "watch-exposure-v1",
          position: 2,
          served: null,
          eligible: 0,
          selected: 1,
          eligibleSelected: 0,
          selectionWithoutImpression: 1,
        },
      ])
    })

    it("scopes full registry identity before truncation without borrowing outside facts", async () => {
      await prisma.watchSurfaceExposure.deleteMany()
      const now = new Date()
      const windowId = randomUUID()
      const base = {
        windowId,
        surface: "watch-home",
        block: "hero",
        presentation: "hero-card",
        placement: "hero-primary",
        policyVersion: "watch-exposure-v1",
        position: 0,
        itemPath: "/watch/scoped.html",
        visibilityCapability: null,
        occurredAt: new Date(now.getTime() - 60000),
        receivedAt: new Date(now.getTime() - 30000),
        expiresAt: new Date(now.getTime() + 86400000),
      }
      await prisma.watchSurfaceExposure.createMany({
        data: [
          { kind: "selected" },
          { kind: "selected", placement: "hero-secondary" },
          { kind: "served", policyVersion: "watch-exposure-v2" },
          { kind: "eligible", surface: "watch-video" },
          { kind: "eligible", presentation: "hero-carousel" },
          ...Array.from({ length: 130 }, (_, index) => ({
            kind: "eligible",
            block: "aaa-outside",
            placement: `outside-${String(index).padStart(3, "0")}`,
          })),
        ].map((fact) => ({
          ...base,
          id: randomUUID(),
          eventId: randomUUID(),
          ...fact,
        })),
      })
      expect(
        (await loadAnonymousWatchExposureBreakdown(prisma, "24h")).truncated,
      ).toBe(true)
      const filter = {
        surface: "watch-home",
        block: "hero",
        presentation: "hero-card",
      }
      const scoped = await loadAnonymousWatchExposureBreakdown(
        prisma,
        "24h",
        filter,
      )
      expect(scoped.truncated).toBe(false)
      expect(scoped.rows).toHaveLength(3)
      expect(
        scoped.rows.every(
          (row) => row.eligible === 0 && row.eligibleSelected === 0,
        ),
      ).toBe(true)
      const primary = await loadAnonymousWatchExposureBreakdown(prisma, "24h", {
        ...filter,
        placement: "hero-primary",
      })
      expect(primary.rows).toEqual(
        scoped.rows.filter((row) => row.placement === "hero-primary"),
      )
      expect(
        await loadAnonymousWatchExposureBreakdown(prisma, "24h", {
          ...filter,
          presentation: "missing",
        }),
      ).toEqual({ rows: [], truncated: false })

      await admin!.query(`
        INSERT INTO recommendation_request VALUES ('scope-home', 'watch-for-you-v1', now() - interval '1 minute'), ('scope-video', 'watch-below-player-v1', now() - interval '1 minute');
        INSERT INTO recommendation_served_item VALUES ('scope-home-item', 'scope-home', 0), ('scope-video-item', 'scope-video', 0);
      `)
      const signedFilter = {
        surface: "watch-home",
        block: "for-you",
        presentation: "recommendation-list",
        policyVersion: "watch-for-you-v1",
      }
      expect(
        await loadWatchExposureBreakdown(prisma, "24h", signedFilter),
      ).toMatchObject([{ ...signedFilter, placement: "primary", served: 1 }])
      expect(
        await loadWatchExposureBreakdown(prisma, "24h", {
          ...signedFilter,
          placement: "secondary",
        }),
      ).toEqual([])
      expect(
        await loadWatchExposureBreakdown(prisma, "24h", {
          ...signedFilter,
          block: "below-player",
        }),
      ).toEqual([])
      expect(
        await loadWatchExposureBreakdown(prisma, "24h", {
          ...signedFilter,
          presentation: "hero-card",
        }),
      ).toEqual([])
      expect(await loadWatchExposureBreakdown(prisma, "24h")).toHaveLength(2)
      expect(
        await loadWatchExposureBreakdown(prisma, "24h", {
          ...signedFilter,
          policyVersion: "watch-below-player-v1",
        }),
      ).toEqual([])
    })

    it("filters policy before the row cap and preserves every matching position", async () => {
      await prisma.watchSurfaceExposure.deleteMany()
      const now = new Date()
      const base = {
        windowId: randomUUID(),
        surface: "watch-video",
        block: "chapters",
        presentation: "carousel",
        placement: "chapters-1",
        itemPath: "/watch/scoped-policy.html",
        visibilityCapability: null,
        receivedAt: new Date(now.getTime() - 30000),
        expiresAt: new Date(now.getTime() + 86400000),
      }
      const at = (offset: number) => new Date(now.getTime() - 60000 + offset)
      await prisma.watchSurfaceExposure.createMany({
        data: Array.from({ length: 70 }, (_, position) =>
          [
            {
              policyVersion: "watch-exposure-v1",
              kind: "eligible",
              occurredAt: at(0),
            },
            {
              policyVersion: "watch-exposure-v2",
              kind: "served",
              occurredAt: at(0),
            },
            {
              policyVersion: "watch-exposure-v2",
              kind: "selected",
              occurredAt: at(2000),
            },
            ...(position === 0
              ? [
                  {
                    policyVersion: "watch-exposure-v2",
                    kind: "eligible",
                    occurredAt: at(1000),
                  },
                ]
              : []),
          ].map((fact) => ({
            ...base,
            position,
            id: randomUUID(),
            eventId: randomUUID(),
            ...fact,
          })),
        ).flat(),
      })
      const filter = {
        surface: base.surface,
        block: base.block,
        presentation: base.presentation,
        placement: base.placement,
      }
      const mixed = await loadAnonymousWatchExposureBreakdown(
        prisma,
        "24h",
        filter,
      )
      expect(mixed.truncated).toBe(true)
      expect(mixed.rows).toHaveLength(128)
      const v2 = await loadAnonymousWatchExposureBreakdown(prisma, "24h", {
        ...filter,
        policyVersion: "watch-exposure-v2",
      })
      expect(v2.truncated).toBe(false)
      expect(v2.rows.map((row) => row.position)).toEqual(
        Array.from({ length: 70 }, (_, position) => position),
      )
      expect(
        v2.rows.every(
          (row) =>
            row.policyVersion === "watch-exposure-v2" &&
            row.served === 1 &&
            row.selected === 1,
        ),
      ).toBe(true)
      expect(v2.rows[0]).toMatchObject({
        eligible: 1,
        eligibleSelected: 1,
        selectionWithoutImpression: 0,
      })
      expect(
        v2.rows
          .slice(1)
          .every(
            (row) =>
              row.eligible === 0 &&
              row.eligibleSelected === 0 &&
              row.selectionWithoutImpression === 1,
          ),
      ).toBe(true)
      const v1 = await loadAnonymousWatchExposureBreakdown(prisma, "24h", {
        ...filter,
        policyVersion: "watch-exposure-v1",
      })
      expect(v1.truncated).toBe(false)
      expect(v1.rows).toHaveLength(70)
      expect(
        v1.rows.every(
          (row) =>
            row.served === null && row.eligible === 1 && row.selected === 0,
        ),
      ).toBe(true)
      expect(
        await loadAnonymousWatchExposureBreakdown(prisma, "24h", {
          ...filter,
          policyVersion: "watch-for-you-v1",
        }),
      ).toEqual({ rows: [], truncated: false })
    })

    it("reconciles 60000 facts within the unchanged report query budget", async () => {
      await prisma.watchSurfaceExposure.deleteMany()
      await admin!.query(`
        INSERT INTO watch_surface_exposure
          (id, event_id, window_id, surface, block, presentation, placement,
           policy_version, position, item_path, kind, visibility_capability,
           occurred_at, received_at, expires_at)
        SELECT 'scale-' || window_number || '-' || kind,
               md5('scale-event-' || window_number || '-' || kind)::uuid,
               md5('scale-window-' || window_number)::uuid,
               'watch-search', 'results', 'result-list', 'search-results',
               'watch-exposure-v1', 0, '/watch/scale.html', kind,
               CASE WHEN kind = 'eligible' THEN 'unknown' END,
               now() - interval '1 hour' + ordinal * interval '1 second',
               now() - interval '30 minutes', now() + interval '29 days'
        FROM generate_series(1, 20000) AS window_number
        CROSS JOIN (VALUES ('rendered', 0), ('eligible', 1), ('selected', 2)) AS facts(kind, ordinal)
      `)
      await admin!.query("ANALYZE watch_surface_exposure")
      const reportStartedAt = Date.now()
      const report = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
      console.info(
        `watch exposure 60000-fact report: elapsedMs=${Date.now() - reportStartedAt}`,
      )
      expect(report.truncated).toBe(false)
      expect(report.rows).toHaveLength(1)
      expect(report.rows[0]).toMatchObject({
        policyVersion: "watch-exposure-v1",
        served: null,
        rendered: 20000,
        eligible: 20000,
        selected: 20000,
        eligibleSelected: 20000,
        selectionWithoutImpression: 0,
        repeats: 0,
        duplicateRate: 0,
        ctr: 1,
        occlusionAware: 0,
        visibilityUnknown: 20000,
      })
    }, 10000)

    it("returns the same 128-group mixed-policy prefix across opposite insertion orders", async () => {
      // This suite owns a disposable schema; reset only its exposure fixtures.
      const now = new Date()
      const rows = Array.from({ length: 65 }, (_, placement) =>
        ["watch-exposure-v1", "watch-exposure-v2"].map((policyVersion) => ({
          id: randomUUID(),
          eventId: randomUUID(),
          windowId: randomUUID(),
          surface: "watch-search",
          block: "results",
          presentation: "result-list",
          placement: `group-${String(placement).padStart(3, "0")}`,
          policyVersion,
          position: 0,
          itemPath: "/watch/truncation.html",
          kind: policyVersion === "watch-exposure-v2" ? "served" : "rendered",
          visibilityCapability: null,
          occurredAt: new Date(now.getTime() - 60_000),
          receivedAt: new Date(now.getTime() - 30_000),
          expiresAt: new Date(now.getTime() + 29 * 86_400_000),
        })),
      )
        .flat()
        .filter(
          ({ placement, policyVersion }) =>
            placement !== "group-000" || policyVersion === "watch-exposure-v1",
        )
      // One leading singleton makes the 128th row split the final v1/v2 tie.
      const expected = rows
        .slice(0, 128)
        .map(({ placement, policyVersion }) => ({
          placement,
          policyVersion,
          served: policyVersion === "watch-exposure-v2" ? 1 : null,
          rendered: policyVersion === "watch-exposure-v1" ? 1 : 0,
        }))
      for (const orderedRows of [rows, [...rows].reverse()]) {
        await prisma.watchSurfaceExposure.deleteMany()
        await prisma.watchSurfaceExposure.createMany({ data: orderedRows })
        const first = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
        const second = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
        expect(first.truncated).toBe(true)
        expect(first.rows).toHaveLength(128)
        expect(
          first.rows.map(({ placement, policyVersion, served, rendered }) => ({
            placement,
            policyVersion,
            served,
            rendered,
          })),
        ).toEqual(expected)
        expect(second).toEqual(first)
        expect(first.rows.at(-1)).toMatchObject({
          placement: "group-064",
          policyVersion: "watch-exposure-v1",
          served: null,
        })
        expect(
          first.rows.some(
            ({ placement, policyVersion }) =>
              placement === "group-064" &&
              policyVersion === "watch-exposure-v2",
          ),
        ).toBe(false)
      }
    })
  },
)
