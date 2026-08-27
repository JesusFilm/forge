import { describe, expect, it } from "vitest"

const expectedRawDiff = `
[*] Changed the \`chunk_embeddings\` table
  [-] Removed index on columns (embedding)

[*] Changed the \`chunks\` table
  [-] Removed index on columns (search_tsv)
  [-] Removed index on columns (tags)
  [*] Altered column \`search_tsv\` (default changed from \`Some(DbGenerated(Some("to_tsvector('english'::regconfig, text)")))\` to \`None\`)
`

describe("RAG schema drift classification", () => {
  it("accepts only the raw SQL objects Prisma cannot model", async () => {
    const { unexpectedSchemaDifferences } =
      await import("../scripts/check-schema-drift.js")
    expect(unexpectedSchemaDifferences(expectedRawDiff)).toEqual([])
  })

  it("fails closed for an additional modeled-column difference", async () => {
    const { unexpectedSchemaDifferences } =
      await import("../scripts/check-schema-drift.js")
    expect(
      unexpectedSchemaDifferences(
        `${expectedRawDiff}\n[+] Added column \`unexpected\``,
      ),
    ).toContain("[+] Added column `unexpected`")
  })

  it("fails when a required raw SQL object disappears", async () => {
    const { unexpectedSchemaDifferences } =
      await import("../scripts/check-schema-drift.js")
    expect(
      unexpectedSchemaDifferences(
        expectedRawDiff.replace(
          "  [-] Removed index on columns (embedding)\n",
          "",
        ),
      ),
    ).toContain(
      "missing expected raw-SQL difference: [-] Removed index on columns (embedding)",
    )
  })
})
