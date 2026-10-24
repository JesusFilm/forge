// Plain JS: the RN tsconfig has no Node types, and these guards need fs/path to
// scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "../..")

// Guard 1: a BCP-47 tag ("en") instead of a slug ("english") returns results
// with every playbackId null. The hook once held a `locale = "en"` default, so
// these keys may appear ONLY in buildWatchSearchInput.
const ALLOWED = new Set(["src/lib/watchSearch.ts"])

// queryNamedLanguageSlug included deliberately: it has HIGHER target-language
// precedence than the rest, so it is the costliest key to inline by accident.
const LANGUAGE_INPUT_KEY =
  /\b(displayLanguageSlug|routeLanguageSlug|targetLanguageSlug|currentWatchLanguageSlug|queryLanguageSlug|queryNamedLanguageSlug|acceptLanguage)\s*:/

// Pure detector over [{ relative, content }] so a positive-control fixture can
// prove the mechanism flags a real violation, not just that today's tree is clean.
function findInlineLanguageInput(entries) {
  return entries
    .filter((entry) => !ALLOWED.has(entry.relative))
    .filter((entry) =>
      entry.content
        .split("\n")
        .some(
          (line) =>
            !/^\s*(\/\/|\*|\/\*)/.test(line) && LANGUAGE_INPUT_KEY.test(line),
        ),
    )
    .map((entry) => entry.relative)
}

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      acc.push(full)
  }
  return acc
}

function readSourceEntries() {
  const files = [
    ...collectSourceFiles(path.join(ROOT, "src")),
    ...collectSourceFiles(path.join(ROOT, "app")),
  ]
  // A broken root resolution or empty scan must not vacuously pass.
  expect(files.length).toBeGreaterThan(50)
  return files.map((file) => ({
    relative: path.relative(ROOT, file),
    content: fs.readFileSync(file, "utf8"),
  }))
}

describe("watchSearch language input stays behind the builder", () => {
  it("no inline language-input keys outside the builder", () => {
    expect(findInlineLanguageInput(readSourceEntries())).toEqual([])
  })

  it("positive control: the detector flags a real violation", () => {
    // Proves the scan mechanism works — without this, a broken regex or root
    // path could make the real-tree assertion pass with zero scanning.
    const offenders = findInlineLanguageInput([
      {
        relative: "src/lib/search.ts",
        content: 'input: { query, displayLanguageSlug: "en" }',
      },
      {
        relative: "src/components/search/Rogue.tsx",
        content: "  routeLanguageSlug: locale,",
      },
      {
        relative: "src/components/search/Comment.tsx",
        content: "// pass displayLanguageSlug: here one day",
      },
      {
        relative: "src/lib/watchSearch.ts",
        content: "displayLanguageSlug: SEARCH_LANGUAGE_SLUG,",
      },
    ])
    expect(offenders).toEqual([
      "src/lib/search.ts",
      "src/components/search/Rogue.tsx",
    ])
  })
})

// Guard 2: renaming the query without SEARCH_OPERATION_NAME (or vice versa)
// silently drops the bearer — search still works, but every device collapses
// into admin's per-IP bucket. Nothing else catches it; both halves typecheck.
describe("search operation name matches the query document", () => {
  function readOperationNames(source) {
    return [...source.matchAll(/\bquery\s+([A-Za-z0-9_]+)\s*\(/g)].map(
      (m) => m[1],
    )
  }

  it("SEARCH_OPERATION_NAME is the operation name declared in WATCH_SEARCH", () => {
    const queries = fs.readFileSync(
      path.join(ROOT, "src/lib/queries.ts"),
      "utf8",
    )
    const authHeaders = fs.readFileSync(
      path.join(ROOT, "src/lib/authHeaders.ts"),
      "utf8",
    )

    // Isolate the WATCH_SEARCH document, then read its `query <Name>(`.
    const doc = queries.split("export const WATCH_SEARCH")[1]
    expect(doc).toBeDefined()
    const declared = readOperationNames(doc)[0]
    expect(declared).toBeDefined()

    const constant = authHeaders.match(
      /SEARCH_OPERATION_NAME\s*=\s*"([^"]+)"/,
    )?.[1]
    expect(constant).toBe(declared)
  })

  it("positive control: the extractor reads a name it is given", () => {
    expect(
      readOperationNames(`= graphql(\`\n  query Renamed($input: X!) {\n`)[0],
    ).toBe("Renamed")
  })
})
