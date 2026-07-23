// Plain JS (like useManagedVideoPlayer.guard.test.js): the RN tsconfig has no
// Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: admin's language inputs take a `language.slug` ("english"), not a
// BCP-47 tag ("en"). A tag resolves the target to a string matching no language
// row, so every result returns UNAVAILABLE with a null playbackId. The original
// bug was these keys inlined at the call site, so they may appear ONLY in the
// builder — every request routes through buildWatchSearchInput.
const ALLOWED = new Set(["src/lib/watchSearch.ts"])

// Bare identifier, not `key:` — shorthand (`{ displayLanguageSlug }`) and a
// spread override would slip past a colon-anchored pattern. Matches the sibling
// useManagedVideoPlayer guard; these names appear nowhere else in src/app.
const LANGUAGE_INPUT_KEY =
  /\b(displayLanguageSlug|routeLanguageSlug|targetLanguageSlug|currentWatchLanguageSlug|queryLanguageSlug|acceptLanguage)\b/

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
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("watchSearch language input stays behind the builder", () => {
  it("no inline language-input keys outside the builder", () => {
    const root = path.resolve(__dirname, "../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
    ]
    // A broken root resolution or empty scan must not vacuously pass.
    expect(files.length).toBeGreaterThan(50)
    const entries = files.map((file) => ({
      relative: path.relative(root, file),
      content: fs.readFileSync(file, "utf8"),
    }))
    expect(findInlineLanguageInput(entries)).toEqual([])
  })

  it("positive control: the detector flags a real violation", () => {
    // Proves the scan mechanism works — without this, a broken regex or root
    // path could make the real-tree assertion pass with zero scanning.
    const offenders = findInlineLanguageInput([
      {
        relative: "app/(tabs)/watch.tsx",
        content: 'input: { query, displayLanguageSlug: "en" }',
      },
      {
        relative: "src/components/search/Rogue.tsx",
        content: "  routeLanguageSlug: locale,",
      },
      {
        relative: "src/components/search/Shorthand.tsx",
        content: "  const input = { query, displayLanguageSlug }",
      },
      {
        relative: "src/components/search/Spread.tsx",
        content: "  { ...base, routeLanguageSlug }",
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
      "app/(tabs)/watch.tsx",
      "src/components/search/Rogue.tsx",
      "src/components/search/Shorthand.tsx",
      "src/components/search/Spread.tsx",
    ])
  })
})
