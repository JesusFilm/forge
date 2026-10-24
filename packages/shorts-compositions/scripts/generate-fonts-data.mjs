// Regenerates src/fonts-data.ts from the vendored woff2 files in fonts/.
// Run from the package root: node scripts/generate-fonts-data.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const FONTS = [
  {
    constName: "MONTSERRAT_LATIN_WOFF2_BASE64",
    file: "montserrat-latin.woff2",
    note: "Montserrat latin subset, variable wght axis (covers 700/900)",
  },
  {
    constName: "INTER_LATIN_WOFF2_BASE64",
    file: "inter-latin.woff2",
    note: "Inter latin subset, variable wght axis (covers 400/600)",
  },
]

const WOFF2_MAGIC = "wOF2"

const blocks = FONTS.map(({ constName, file, note }) => {
  const bytes = readFileSync(join(packageRoot, "fonts", file))
  if (bytes.subarray(0, 4).toString("latin1") !== WOFF2_MAGIC) {
    throw new Error(`fonts/${file} is not a woff2 file (missing wOF2 magic)`)
  }
  const base64 = bytes.toString("base64")
  return `// ${note} — source: fonts/${file}\nexport const ${constName} =\n  "${base64}"\n`
})

const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/generate-fonts-data.mjs
// Base64-embedded woff2 fonts vendored under fonts/ (Google Fonts, latin
// subsets). Embedding guarantees identical bytes in the manager <Player>
// preview and the shorts-worker render — no fonts.gstatic.com dependency.

`

writeFileSync(
  join(packageRoot, "src", "fonts-data.ts"),
  header + blocks.join("\n"),
)
console.log("Wrote src/fonts-data.ts")
