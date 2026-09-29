// MASK_ALL_INPUTS masks input fields only, and a missing per-element mask
// changes nothing on screen. The leak shows only in a third-party recording,
// so this suite pins the source of each surface (R19).

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, ...parts), "utf8")
}

const RUM_CONFIG = read("..", "..", "DatadogRum.tsx")

/** The one block that holds the account PII on a surface. */
const IDENTITY_BLOCK =
  /<SessionReplayView\.MaskAll[^>]*>([\s\S]*?)<\/SessionReplayView\.MaskAll>/

/** The JSX expressions that show account PII on each surface. The header
 *  shows only the display name (or the email) and the name's initial. */
type Surface = {
  file: string
  source: string
  masked: string[]
}

const SURFACES: Surface[] = [
  {
    file: "MyWatchHeader.tsx",
    source: read("..", "MyWatchHeader.tsx"),
    masked: ["{displayName}", "{initial}"],
  },
]

/** No JSX expression may render a raw user field outside the mask. */
const RAW_USER_FIELD = /\{\s*snapshot\.user\.(email|name)\b[^}]*\}/

describe.each(SURFACES)(
  "account PII is masked in session replays: $file",
  ({ source, masked }) => {
    it("wraps the identity block in a replay mask", () => {
      expect(source).toMatch(IDENTITY_BLOCK)
    })

    it.each(masked)("renders %s inside the mask", (expression) => {
      const inside = source.match(IDENTITY_BLOCK)?.[1] ?? ""
      expect(inside).toContain(expression)
    })

    it("renders no account PII outside the mask", () => {
      // A future line added beside the wrapper would silently reopen the leak.
      const outside = source.replace(IDENTITY_BLOCK, "")
      for (const expression of masked) {
        expect(outside).not.toContain(expression)
      }
      expect(outside).not.toMatch(RAW_USER_FIELD)
    })
  },
)

describe("the global replay level", () => {
  it("still masks inputs only", () => {
    // If the global level ever becomes MASK_ALL, the per-element wrapper is
    // redundant rather than load-bearing — and this test should be revisited
    // rather than silently guarding nothing.
    expect(RUM_CONFIG).toContain(
      "textAndInputPrivacyLevel: TextAndInputPrivacyLevel.MASK_ALL_INPUTS",
    )
  })
})
