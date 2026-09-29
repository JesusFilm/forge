/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// The CI suites cannot import web's ESM translator, so catalogChecks.js keeps a
// copy of its contract rule. This guard runs the real one in a child Node
// process on the same cases, so a rule that web adds later fails here first.
const childProcess = require("child_process")
const path = require("path")
const { pathToFileURL } = require("url")
const { contractError } = require("../lib/catalogChecks")

const WEB_TRANSLATOR = path.resolve(
  __dirname,
  "../../../../web/scripts/openai-catalog-translator.mjs",
)

const KEY = "Common.a"
const PLURAL = "{count, plural, one {# video} other {# videos}}"
// [source, value] pairs for KEY.
const CASES = [
  ["Go back", "Volver"],
  ["Go back", undefined],
  ["Go back", "   "],
  ["", ""],
  ["Go back", "```Volver```"],
  ["Hi {name}", "Hola {name"],
  ["Hi {name}", "Hola {nombre}"],
  ["Hi {name}", "Hola"],
  ["<b>Hi</b>", "Hola"],
  ["<b>Hi</b>", "<strong>Hola</strong>"],
  [PLURAL, "{count, plural, one {un vídeo} other {vídeos}}"],
  [PLURAL, "{count, plural, one {# vídeo} other {# vídeos}}"],
  [PLURAL, "{count} vídeos"],
  ["{count} videos", "vídeos"],
]

function webResults() {
  const script = `
    const { messageContractError } = await import(${JSON.stringify(pathToFileURL(WEB_TRANSLATOR).href)})
    const cases = JSON.parse(process.argv[1])
    process.stdout.write(JSON.stringify(cases.map(([s, v]) => messageContractError(${JSON.stringify(KEY)}, s, v ?? undefined))))
  `
  const result = childProcess.spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, JSON.stringify(CASES)],
    { encoding: "utf8" },
  )
  expect(result.stderr).toBe("")
  return JSON.parse(result.stdout)
}

describe("contract mirror", () => {
  it("agrees with web's messageContractError on every case", () => {
    const mirror = CASES.map(([source, value]) =>
      contractError(KEY, source, value),
    )
    expect(mirror).toEqual(webResults())
    // The table must hold passing and failing cases, or agreement proves little.
    expect(mirror.filter((result) => result === null).length).toBeGreaterThan(1)
    expect(mirror.filter((result) => result !== null).length).toBeGreaterThan(5)
  })
})
