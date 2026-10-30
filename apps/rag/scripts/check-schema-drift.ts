import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const EXPECTED_RAW_SQL_DIFFERENCES = new Set([
  "[*] Changed the `chunk_embeddings` table",
  "[-] Removed index on columns (embedding)",
  "[*] Changed the `chunks` table",
  "[-] Removed index on columns (search_tsv)",
  "[-] Removed index on columns (tags)",
  "[*] Altered column `search_tsv` (default changed from `Some(DbGenerated(Some(\"to_tsvector('english'::regconfig, text)\")))` to `None`)",
])

export class SchemaDriftError extends Error {
  override readonly name = "SchemaDriftError"
}

export const unexpectedSchemaDifferences = (diff: string): string[] => {
  const observed = new Set(
    diff
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  )

  return [
    ...[...observed].filter(
      (difference) => !EXPECTED_RAW_SQL_DIFFERENCES.has(difference),
    ),
    ...[...EXPECTED_RAW_SQL_DIFFERENCES]
      .filter((difference) => !observed.has(difference))
      .map(
        (difference) => `missing expected raw-SQL difference: ${difference}`,
      ),
  ]
}

const main = (): void => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new SchemaDriftError("DATABASE_URL is required for db:drift:check")
  }

  const diff = execFileSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-url",
      databaseUrl,
      "--to-schema-datamodel",
      "prisma/schema.prisma",
    ],
    { encoding: "utf8" },
  )
  const unexpected = unexpectedSchemaDifferences(diff)

  if (unexpected.length > 0) {
    throw new SchemaDriftError(
      `Prisma schema and migrated database drifted:\n${unexpected.join("\n")}`,
    )
  }

  console.log(
    "Prisma schema matches migrations plus documented raw-SQL objects.",
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
