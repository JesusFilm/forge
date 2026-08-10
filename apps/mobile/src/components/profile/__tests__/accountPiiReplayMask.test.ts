/**
 * Session Replay records the rendered screen. The global level is
 * MASK_ALL_INPUTS, which masks input FIELDS — static <Text> is captured
 * verbatim — so the account identity block is masked per-element instead.
 *
 * Nothing else can catch a regression here: removing the wrapper breaks no
 * behaviour, no test, and nothing visible on screen. The leak is silent and
 * only appears in a recording held by a third party. apps/mobile has no
 * component-render tests (KTD11), so this pins the source. Node globals are
 * declared locally rather than via @types/node — KTD11 forbids new test deps.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const ACCOUNT_SECTION = fs.readFileSync(
  path.join(__dirname, "..", "AccountSection.tsx"),
  "utf8",
)
const RUM_CONFIG = fs.readFileSync(
  path.join(__dirname, "..", "..", "DatadogRum.tsx"),
  "utf8",
)

/** The block holding both PII lines: the email AND the name it falls back to. */
const IDENTITY_BLOCK =
  /<SessionReplayView\.MaskAll[^>]*>([\s\S]*?)<\/SessionReplayView\.MaskAll>/

describe("account PII is masked in session replays", () => {
  it("wraps the identity block in a replay mask", () => {
    expect(ACCOUNT_SECTION).toMatch(IDENTITY_BLOCK)
  })

  it("masks the raw email", () => {
    const inside = ACCOUNT_SECTION.match(IDENTITY_BLOCK)?.[1] ?? ""
    expect(inside).toContain("snapshot.user.email")
  })

  it("masks the display name too, since it falls back to the email", () => {
    // `displayName = user.name?.trim() || user.email` — masking only the
    // email line would still leak it whenever the account has no name,
    // which is exactly the Hide My Email case.
    const inside = ACCOUNT_SECTION.match(IDENTITY_BLOCK)?.[1] ?? ""
    expect(inside).toContain("{displayName}")
  })

  it("renders no account PII outside the mask", () => {
    // A future line added below the wrapper would silently reopen the leak.
    const outside = ACCOUNT_SECTION.replace(IDENTITY_BLOCK, "")
    expect(outside).not.toContain("{snapshot.user.email}")
    expect(outside).not.toContain("{displayName}")
  })

  it("still relies on the global level that masks inputs only", () => {
    // If the global level ever becomes MASK_ALL, the per-element wrapper is
    // redundant rather than load-bearing — and this test should be revisited
    // rather than silently guarding nothing.
    expect(RUM_CONFIG).toContain(
      "textAndInputPrivacyLevel: TextAndInputPrivacyLevel.MASK_ALL_INPUTS",
    )
  })
})
