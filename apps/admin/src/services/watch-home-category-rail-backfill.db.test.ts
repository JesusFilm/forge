import { readFileSync } from "node:fs"

import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

import adminPackage from "../../package.json"

const RUN_REAL_DB_TEST =
  process.env.WATCH_HOME_CATEGORY_RAIL_BACKFILL_DB_TEST === "1"
const backfillSql = readFileSync(
  new URL(
    "../../prisma/backfills/watch-home-category-rail-block.sql",
    import.meta.url,
  ),
  "utf8",
)

const expectedCategoryIds = WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id)

function blockTypes(value: unknown): Array<string | undefined> | null {
  if (!Array.isArray(value)) return null
  return value.map((block) =>
    block != null && typeof block === "object" && !Array.isArray(block)
      ? ((block as Record<string, unknown>).t as string | undefined)
      : undefined,
  )
}

describe("Watch homepage category rail post-deploy backfill contract", () => {
  it("contains the complete default catalog in shared order", () => {
    let previousIndex = -1
    for (const id of expectedCategoryIds) {
      const index = backfillSql.indexOf(`'${id}'`)
      expect(index).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  it("targets canonical and effective-draft homepages only", () => {
    expect(backfillSql).toContain("locale.is_homepage = true")
    expect(backfillSql).toContain("revision.entity_type = 'ExperienceLocale'")
    expect(backfillSql).toContain("revision.status = 'draft'")
    expect(backfillSql).toMatch(/jsonb_typeof\(locale\.blocks\) = 'array'/)
    expect(backfillSql).toMatch(
      /jsonb_typeof\(revision\.snapshot #> '\{data,blocks\}'\) = 'array'/,
    )

    const draftTargetsStart = backfillSql.indexOf("WITH draft_targets AS (")
    expect(draftTargetsStart).toBeGreaterThan(-1)
    const draftTargetsSql = backfillSql.slice(draftTargetsStart)
    expect(draftTargetsSql).not.toContain("AND locale.is_homepage = true")
    expect(draftTargetsSql).toMatch(
      /COALESCE\([\s\S]*revision\.snapshot #>> '\{data,isHomepage\}'[\s\S]*locale\.is_homepage[\s\S]*\) = true/,
    )
  })

  it("executes with the committed Prisma schema", () => {
    expect(
      adminPackage.scripts["db:backfill:watch-home-category-rail"],
    ).toContain("--schema prisma/schema.prisma")
  })

  it("serializes activation and gates every write on marker absence", () => {
    expect(backfillSql).toContain("pg_advisory_xact_lock")
    expect(backfillSql).toMatch(
      /IF EXISTS \([\s\S]*FROM sync_state[\s\S]*watch-home-category-rail-backfill-v1[\s\S]*\) THEN[\s\S]*RETURN;/,
    )
    expect(backfillSql).toContain("INSERT INTO sync_state")
    expect(backfillSql).toContain("'watch-home-category-rail-backfill-v1'")
    expect(backfillSql).toContain("ON CONFLICT (phase) DO NOTHING")
  })
})

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch homepage category rail post-deploy backfill against real PostgreSQL",
  () => {
    const schemaName = `watch_category_rail_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    let client: Client

    beforeAll(async () => {
      const connectionString = process.env.DATABASE_URL
      if (connectionString == null || connectionString.length === 0) {
        throw new Error(
          "DATABASE_URL is required when WATCH_HOME_CATEGORY_RAIL_BACKFILL_DB_TEST=1",
        )
      }

      client = new Client({ connectionString })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}"`)
      await client.query(`
        CREATE TABLE experience_locale (
          id text PRIMARY KEY,
          is_homepage boolean NOT NULL,
          blocks jsonb NOT NULL
        );
        CREATE TYPE "RevisionStatus" AS ENUM ('draft', 'historical', 'discarded');
        CREATE TABLE content_revision (
          id text PRIMARY KEY,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          snapshot jsonb NOT NULL,
          status "RevisionStatus" NOT NULL
        );
        CREATE TABLE sync_state (
          phase text PRIMARY KEY,
          last_synced_at timestamp(3) NOT NULL,
          stats jsonb NOT NULL DEFAULT '{}',
          updated_at timestamp(3) NOT NULL
        );
      `)

      const locales = [
        [
          "home-hero",
          true,
          [
            { t: "text" },
            { t: "watchHomeHero" },
            { t: "text", sectionKey: "after" },
          ],
        ],
        ["home-no-hero", true, [{ t: "text" }]],
        ["non-home", false, [{ t: "watchHomeHero" }]],
        ["promoted-home", false, [{ t: "text" }]],
        [
          "home-existing",
          true,
          [
            { t: "watchHomeHero" },
            { t: "watchHomeCategoryRail", categoryIds: ["family"] },
          ],
        ],
        ["home-malformed", true, { t: "text" }],
      ] as const
      for (const [id, isHomepage, blocks] of locales) {
        await client.query(
          "INSERT INTO experience_locale (id, is_homepage, blocks) VALUES ($1, $2, $3::jsonb)",
          [id, isHomepage, JSON.stringify(blocks)],
        )
      }

      const revisions = [
        [
          "draft-home",
          "ExperienceLocale",
          "home-hero",
          { data: { isHomepage: true, blocks: [{ t: "watchHomeHero" }] } },
          "draft",
        ],
        [
          "historical-home",
          "ExperienceLocale",
          "home-hero",
          { data: { isHomepage: true, blocks: [{ t: "watchHomeHero" }] } },
          "historical",
        ],
        [
          "draft-non-home",
          "ExperienceLocale",
          "non-home",
          { data: { isHomepage: false, blocks: [{ t: "text" }] } },
          "draft",
        ],
        [
          "draft-promoted-home",
          "ExperienceLocale",
          "promoted-home",
          { data: { isHomepage: true, blocks: [{ t: "text" }] } },
          "draft",
        ],
        [
          "draft-malformed",
          "ExperienceLocale",
          "home-malformed",
          { data: { isHomepage: true, blocks: { t: "text" } } },
          "draft",
        ],
        [
          "draft-existing",
          "ExperienceLocale",
          "home-existing",
          {
            data: {
              isHomepage: true,
              blocks: [{ t: "watchHomeCategoryRail", categoryIds: ["family"] }],
            },
          },
          "draft",
        ],
      ] as const
      for (const [id, entityType, entityId, snapshot, status] of revisions) {
        await client.query(
          "INSERT INTO content_revision (id, entity_type, entity_id, snapshot, status) VALUES ($1, $2, $3, $4::jsonb, $5)",
          [id, entityType, entityId, JSON.stringify(snapshot), status],
        )
      }
    })

    afterAll(async () => {
      if (client == null) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("inserts after the first hero or first, skips invalid rows, and is idempotent", async () => {
      await client.query(backfillSql)

      const firstRun = await client.query<{
        id: string
        blocks?: unknown
        snapshot?: { data?: { blocks?: unknown } }
      }>(`
        SELECT id, blocks, NULL::jsonb AS snapshot FROM experience_locale
        UNION ALL
        SELECT id, NULL::jsonb AS blocks, snapshot FROM content_revision
        ORDER BY id
      `)

      const locale = (id: string) =>
        firstRun.rows.find((row) => row.id === id)?.blocks
      const draft = (id: string) =>
        firstRun.rows.find((row) => row.id === id)?.snapshot?.data?.blocks

      expect(blockTypes(locale("home-hero"))).toEqual([
        "text",
        "watchHomeHero",
        "watchHomeCategoryRail",
        "text",
      ])
      expect(blockTypes(locale("home-no-hero"))).toEqual([
        "watchHomeCategoryRail",
        "text",
      ])
      expect(blockTypes(locale("non-home"))).toEqual(["watchHomeHero"])
      expect(blockTypes(locale("promoted-home"))).toEqual(["text"])
      expect(blockTypes(locale("home-existing"))).toHaveLength(2)
      expect(locale("home-malformed")).toEqual({ t: "text" })
      expect(blockTypes(draft("draft-home"))).toEqual([
        "watchHomeHero",
        "watchHomeCategoryRail",
      ])
      expect(blockTypes(draft("historical-home"))).toEqual(["watchHomeHero"])
      expect(blockTypes(draft("draft-non-home"))).toEqual(["text"])
      expect(blockTypes(draft("draft-promoted-home"))).toEqual([
        "watchHomeCategoryRail",
        "text",
      ])
      expect(draft("draft-malformed")).toEqual({ t: "text" })
      expect(blockTypes(draft("draft-existing"))).toHaveLength(1)

      const marker = await client.query(
        "SELECT phase, last_synced_at, stats, updated_at FROM sync_state WHERE phase = 'watch-home-category-rail-backfill-v1'",
      )
      expect(marker.rows).toHaveLength(1)
      expect(marker.rows[0]).toMatchObject({
        phase: "watch-home-category-rail-backfill-v1",
        stats: {
          completed: true,
          artifact: "watch-home-category-rail-block.sql",
        },
      })

      await client.query(backfillSql)
      const secondRun = await client.query(`
        SELECT id, blocks, NULL::jsonb AS snapshot FROM experience_locale
        UNION ALL
        SELECT id, NULL::jsonb AS blocks, snapshot FROM content_revision
        ORDER BY id
      `)
      expect(secondRun.rows).toEqual(firstRun.rows)
      const secondMarker = await client.query(
        "SELECT phase, last_synced_at, stats, updated_at FROM sync_state WHERE phase = 'watch-home-category-rail-backfill-v1'",
      )
      expect(secondMarker.rows).toEqual(marker.rows)

      await client.query(
        `UPDATE experience_locale
         SET blocks = '[{"t":"text","authored":"after-activation"}]'::jsonb
         WHERE id = 'home-no-hero'`,
      )
      await client.query(backfillSql)
      const authoredAbsence = await client.query(
        "SELECT blocks FROM experience_locale WHERE id = 'home-no-hero'",
      )
      expect(authoredAbsence.rows[0]?.blocks).toEqual([
        { t: "text", authored: "after-activation" },
      ])
      const thirdMarker = await client.query(
        "SELECT phase, last_synced_at, stats, updated_at FROM sync_state WHERE phase = 'watch-home-category-rail-backfill-v1'",
      )
      expect(thirdMarker.rows).toEqual(marker.rows)
    })
  },
)
