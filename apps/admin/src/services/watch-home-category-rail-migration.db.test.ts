import { readFileSync } from "node:fs"

import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

const RUN_REAL_DB_TEST =
  process.env.WATCH_HOME_CATEGORY_RAIL_MIGRATION_DB_TEST === "1"
const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0053_watch_home_category_rail_block/migration.sql",
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

describe("Watch homepage category rail migration contract", () => {
  it("contains the complete default catalog in shared order", () => {
    let previousIndex = -1
    for (const id of expectedCategoryIds) {
      const index = migrationSql.indexOf(`'${id}'`)
      expect(index).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  it("targets canonical homepages and active ExperienceLocale drafts only", () => {
    expect(migrationSql).toContain("locale.is_homepage = true")
    expect(migrationSql).toContain("revision.entity_type = 'ExperienceLocale'")
    expect(migrationSql).toContain("revision.status = 'DRAFT'")
    expect(migrationSql).toMatch(/jsonb_typeof\(locale\.blocks\) = 'array'/)
    expect(migrationSql).toMatch(
      /jsonb_typeof\(revision\.snapshot #> '\{data,blocks\}'\) = 'array'/,
    )
  })
})

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch homepage category rail migration against real PostgreSQL",
  () => {
    const schemaName = `watch_category_rail_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    let client: Client

    beforeAll(async () => {
      const connectionString = process.env.DATABASE_URL
      if (connectionString == null || connectionString.length === 0) {
        throw new Error(
          "DATABASE_URL is required when WATCH_HOME_CATEGORY_RAIL_MIGRATION_DB_TEST=1",
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
        CREATE TABLE content_revision (
          id text PRIMARY KEY,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          snapshot jsonb NOT NULL,
          status text NOT NULL
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
          "DRAFT",
        ],
        [
          "historical-home",
          "ExperienceLocale",
          "home-hero",
          { data: { isHomepage: true, blocks: [{ t: "watchHomeHero" }] } },
          "HISTORICAL",
        ],
        [
          "draft-non-home",
          "ExperienceLocale",
          "non-home",
          { data: { isHomepage: false, blocks: [{ t: "text" }] } },
          "DRAFT",
        ],
        [
          "draft-malformed",
          "ExperienceLocale",
          "home-malformed",
          { data: { isHomepage: true, blocks: { t: "text" } } },
          "DRAFT",
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
          "DRAFT",
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
      await client.query(migrationSql)

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
      expect(blockTypes(locale("home-existing"))).toHaveLength(2)
      expect(locale("home-malformed")).toEqual({ t: "text" })
      expect(blockTypes(draft("draft-home"))).toEqual([
        "watchHomeHero",
        "watchHomeCategoryRail",
      ])
      expect(blockTypes(draft("historical-home"))).toEqual(["watchHomeHero"])
      expect(blockTypes(draft("draft-non-home"))).toEqual(["text"])
      expect(draft("draft-malformed")).toEqual({ t: "text" })
      expect(blockTypes(draft("draft-existing"))).toHaveLength(1)

      await client.query(migrationSql)
      const secondRun = await client.query(`
        SELECT id, blocks, NULL::jsonb AS snapshot FROM experience_locale
        UNION ALL
        SELECT id, NULL::jsonb AS blocks, snapshot FROM content_revision
        ORDER BY id
      `)
      expect(secondRun.rows).toEqual(firstRun.rows)
    })
  },
)
