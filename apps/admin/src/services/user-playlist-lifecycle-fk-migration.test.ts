import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/0055_user_playlist_lifecycle_fk/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

describe("User Playlist lifecycle foreign key migration", () => {
  it("serializes playlist creation with lifecycle erasure and cascades committed rows", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("owner_subject") REFERENCES "consumer_lifecycle_projection"("owner_subject")',
    )
    expect(migration).toContain("ON DELETE CASCADE")
    expect(migration).toContain("ON UPDATE CASCADE")
    expect(migration).not.toMatch(/NOT VALID/i)
  })
})
