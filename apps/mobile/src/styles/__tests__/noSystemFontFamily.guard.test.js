// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs, path, and the TypeScript compiler.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

// Guard: on Android, React Native draws a named family in Regular or Bold
// only, so weight 500 or 600 with the family "System" draws Regular. With no
// family, iOS draws the same system font and Android keeps the weight.
const MOBILE_ROOT = path.join(__dirname, "..", "..", "..")
const ROOTS = ["app", "src"]

function sourceFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name)) files.push(full)
  }
  return files
}

/** Every string value "System" in the source, as 1-based line numbers. The
 *  parser, not a regex, so a comment that names the family cannot trip it. */
function systemFamilyLines(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest)
  const lines = []
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === "System"
    ) {
      const start = node.getStart(source)
      lines.push(source.getLineAndCharacterOfPosition(start).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

describe("the system font family", () => {
  const files = ROOTS.flatMap((root) =>
    sourceFiles(path.join(MOBILE_ROOT, root)),
  )

  it("scans the app's source", () => {
    // Anti-vacuous: a wrong root would find no files and pass.
    expect(files).toContain(
      path.join(MOBILE_ROOT, "src", "components", "watch", "PlaybackHost.tsx"),
    )
    expect(files).toContain(
      path.join(MOBILE_ROOT, "app", "watch", "[slug].tsx"),
    )
  })

  it("positive control: finds every way to name the family, and no comment", () => {
    const sample = [
      'const a = { fontFamily: "System" }',
      "const b = { fontFamily: 'System' }",
      "const c = {",
      "  fontFamily:",
      '    "System",',
      "}",
      'function d() { return "System" }',
      "const e = `System`",
      '// a comment may name "System"',
    ].join("\n")
    expect(systemFamilyLines("sample.tsx", sample)).toEqual([1, 2, 5, 7, 8])
  })

  it('is never named: no source holds the string "System"', () => {
    const offenders = files.flatMap((file) =>
      systemFamilyLines(file, fs.readFileSync(file, "utf8")).map(
        (line) => `${path.relative(MOBILE_ROOT, file)}:${line}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
