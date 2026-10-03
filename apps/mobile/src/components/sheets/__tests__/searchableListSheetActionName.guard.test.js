// KTD15: a list sheet with no `actionName` names its taps "list-sheet-row", so
// Datadog cannot tell one sheet from another. Every call site names its own.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..", "..", "..", "..")
const COMPONENT = path.join(
  "src",
  "components",
  "sheets",
  "SearchableListSheet.tsx",
)

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "node_modules"
        ? []
        : sourceFiles(full)
    }
    return /\.tsx$/.test(entry.name) ? [full] : []
  })
}

// Each self-closing `<SearchableListSheet ... />`; a `>` inside a generic type
// or an arrow prop must not end the match early.
function unnamedCallSites(source) {
  const sites = []
  const pattern = /<SearchableListSheet\b[\s\S]*?\/>/g
  for (const match of source.matchAll(pattern)) {
    if (!/\bactionName=/.test(match[0])) sites.push(match[0].slice(0, 60))
  }
  return sites
}

describe("every SearchableListSheet call site passes an actionName", () => {
  const files = ["app", "src"]
    .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
    .filter((file) => !file.endsWith(COMPONENT))

  it("finds the call sites", () => {
    const withSheet = files.filter((file) =>
      fs.readFileSync(file, "utf8").includes("<SearchableListSheet"),
    )
    expect(withSheet.length).toBeGreaterThanOrEqual(4)
  })

  it("has no unnamed call site", () => {
    const offenders = files.flatMap((file) =>
      unnamedCallSites(fs.readFileSync(file, "utf8")).map(
        (site) => `${path.relative(ROOT, file)}: ${site}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  it("flags a call site with no actionName (negative control)", () => {
    const bare = "<SearchableListSheet\n  rows={rows}\n  onSelect={pick}\n/>"
    expect(unnamedCallSites(bare)).toHaveLength(1)
    const named =
      '<SearchableListSheet<Row>\n  onSelect={(row) => pick(row)}\n  actionName="x"\n/>'
    expect(unnamedCallSites(named)).toHaveLength(0)
  })
})
