/** Project the exhaustive matrix through Web's actual selected-audio locale resolver. */
import assert from "node:assert/strict"
import { createReadStream } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  isPublicWatchHomeLanguageSlug,
  resolveWatchLocaleIdentity,
} from "../../../../apps/web/src/lib/locale"

async function main() {
  const { values } = parseArgs({ options: { "raw-dir": { type: "string" } } })
  assert(values["raw-dir"], "Provide --raw-dir from audit_all_contexts.ts")
  const directory = dirname(resolve(process.argv[1]))
  const snapshot: {
    languages: { audioLanguageSlug: string; coreLanguageId: string }[]
  } = JSON.parse(
    await readFile(
      resolve(values["raw-dir"], "all-context-catalog-snapshot.json"),
      "utf8",
    ),
  )
  const identities = new Map(
    snapshot.languages.map((language) => [
      language.audioLanguageSlug,
      {
        ...language,
        ...resolveWatchLocaleIdentity(language.audioLanguageSlug),
        publicHomepageLanguage: isPublicWatchHomeLanguageSlug(
          language.audioLanguageSlug,
        ),
      },
    ]),
  )
  let columns: string[] = []
  const selectedRows: Record<string, string>[] = []
  const lines = createInterface({
    input: createReadStream(
      resolve(values["raw-dir"], "all-context-coverage.csv"),
    ),
    crlfDelay: Infinity,
  })
  for await (const line of lines) {
    // This generated numeric/slug matrix contains no quoted fields. Fail closed
    // if that changes, instead of silently misparsing general CSV.
    assert(!line.includes('"'), "Unexpected quoted field in generated matrix")
    if (!columns.length) {
      columns = line.split(",")
      continue
    }
    const cells = line.split(",")
    const identity = identities.get(cells[1])
    if (identity?.locale !== cells[0]) continue
    assert.equal(cells.length, columns.length)
    selectedRows.push({
      ...Object.fromEntries(
        columns.map((column, index) => [column, cells[index]]),
      ),
      htmlLang: identity.htmlLang,
      publicHomepageLanguage: String(identity.publicHomepageLanguage),
    })
  }
  assert.equal(selectedRows.length, identities.size)
  assert.equal(
    new Set(selectedRows.map((row) => row.audioLanguageSlug)).size,
    identities.size,
  )
  selectedRows.sort((a, b) =>
    a.audioLanguageSlug.localeCompare(b.audioLanguageSlug),
  )
  const outputColumns = [
    ...columns.slice(0, 3),
    "htmlLang",
    "publicHomepageLanguage",
    ...columns.slice(3),
  ]
  await writeFile(
    resolve(directory, "all-context-web-default-coverage.csv"),
    [
      outputColumns.join(","),
      ...selectedRows.map((row) =>
        outputColumns.map((key) => row[key]).join(","),
      ),
    ].join("\n") + "\n",
  )
  const buckets = (field: string) => ({
    atLeast6: selectedRows.filter((row) => Number(row[field]) >= 6).length,
    atLeast30: selectedRows.filter((row) => Number(row[field]) >= 30).length,
    atLeast44: selectedRows.filter((row) => Number(row[field]) >= 44).length,
    oneTo5: selectedRows.filter(
      (row) => Number(row[field]) > 0 && Number(row[field]) < 6,
    ).length,
    zero: selectedRows.filter((row) => Number(row[field]) === 0).length,
  })
  const summary = {
    status:
      "local-metadata-audit-projected-through-current-web-locale-resolver",
    audioLanguageCount: identities.size,
    publicHomepageLanguages: [...identities.values()].filter(
      (row) => row.publicHomepageLanguage,
    ).length,
    localesUsed: [...new Set(selectedRows.map((row) => row.locale))].sort(),
    starterCoverage: buckets("startUnique"),
    inventoryUpperBoundCoverage: buckets("eligibleVideoIdsUpperBound"),
    poolCoverage: Object.fromEntries(
      columns
        .filter((column) => column.startsWith("pool:"))
        .map((column) => [column.slice(5), buckets(column)]),
    ),
    zeroDueToMissingDisplay: selectedRows.filter(
      (row) =>
        Number(row.startUnique) === 0 &&
        Number(row["rejected:locale_unpublished"]) > 0,
    ).length,
  }
  await writeFile(
    resolve(directory, "all-context-web-default-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  )
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
