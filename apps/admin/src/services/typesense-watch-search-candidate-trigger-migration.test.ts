import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

describe("Watch search candidate trigger repair migration", () => {
  it("groups the JSON extraction before the containment operator", () => {
    expect(migrationSql).toContain(
      `NEW."owned_collections" @> (NEW."deletion_progress"->'deletedCollections')`,
    )
    expect(migrationSql).not.toContain(
      `NEW."owned_collections" @> NEW."deletion_progress"->'deletedCollections'`,
    )
  })
})
