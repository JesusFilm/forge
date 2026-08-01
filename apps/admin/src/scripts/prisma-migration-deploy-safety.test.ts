import { readdirSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url)
const concurrentIndexPattern =
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i

function maskSqlCommentsAndQuotedContent(sql: string) {
  let masked = ""
  let index = 0

  const maskCharacter = (character: string) => (character === "\n" ? "\n" : " ")

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      while (index < sql.length && sql[index] !== "\n") {
        masked += " "
        index += 1
      }
      continue
    }

    if (sql.startsWith("/*", index)) {
      let depth = 0
      while (index < sql.length) {
        if (sql.startsWith("/*", index)) {
          depth += 1
          masked += "  "
          index += 2
          continue
        }
        if (sql.startsWith("*/", index)) {
          depth -= 1
          masked += "  "
          index += 2
          if (depth === 0) break
          continue
        }
        masked += maskCharacter(sql[index])
        index += 1
      }
      continue
    }

    const character = sql[index]
    if (character === "'" || character === '"') {
      const quote = character
      masked += " "
      index += 1
      while (index < sql.length) {
        masked += maskCharacter(sql[index])
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            masked += " "
            index += 2
            continue
          }
          index += 1
          break
        }
        if (sql[index] === "\\" && index + 1 < sql.length) {
          masked += maskCharacter(sql[index + 1])
          index += 2
          continue
        }
        index += 1
      }
      continue
    }

    if (character === "$") {
      const delimiter = sql
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (delimiter != null) {
        const end = sql.indexOf(delimiter, index + delimiter.length)
        const stop = end === -1 ? sql.length : end + delimiter.length
        while (index < stop) {
          masked += maskCharacter(sql[index])
          index += 1
        }
        continue
      }
    }

    masked += character
    index += 1
  }

  return masked
}

function containsConcurrentIndex(sql: string) {
  return concurrentIndexPattern.test(maskSqlCommentsAndQuotedContent(sql))
}

function concurrentIndexMigrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const sql = readFileSync(
        new URL(`${entry.name}/migration.sql`, migrationsDir),
        "utf8",
      )
      return containsConcurrentIndex(sql)
    })
    .map((entry) => entry.name)
}

describe("Admin Prisma migration deploy safety", () => {
  it("rejects concurrent index creation in transactional migrations", () => {
    expect(concurrentIndexMigrations()).toEqual([])
  })

  it("ignores unsafe-looking text inside SQL comments", () => {
    expect(
      containsConcurrentIndex(`
          -- CREATE INDEX CONCURRENTLY "commented_line" ON "example"("id");
          /* CREATE INDEX CONCURRENTLY "commented_block" ON "example"("id"); */
          CREATE INDEX "safe_index" ON "example"("id");
        `),
    ).toBe(false)
  })

  it("detects unique concurrent indexes", () => {
    expect(
      containsConcurrentIndex(
        'CREATE UNIQUE INDEX CONCURRENTLY "unsafe" ON "example"("id");',
      ),
    ).toBe(true)
  })

  it("does not let quoted comment markers hide executable unsafe DDL", () => {
    expect(
      containsConcurrentIndex(`
        SELECT '-- not a comment'; CREATE INDEX CONCURRENTLY "unsafe" ON "example"("id");
      `),
    ).toBe(true)
  })

  it("ignores unsafe-looking text inside quoted SQL content", () => {
    expect(
      containsConcurrentIndex(`
        SELECT 'CREATE INDEX CONCURRENTLY "string_value" ON "example"("id")';
        SELECT $$CREATE UNIQUE INDEX CONCURRENTLY "body" ON "example"("id")$$;
      `),
    ).toBe(false)
  })
})
