/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// accepted_codes in language-id.py, run by real Python through uv. The command
// suite fakes uv, so only this suite runs the verdict rules. CI installs uv;
// a local run without uv skips the suite. The model never loads.
const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const checks = require("../lib/catalogChecks")
const GLOTLID = require("./fixtures/glotlid-languages.json")

const SCRIPT = path.join(__dirname, "../language-id.py")
const KNOWN = new Set(GLOTLID.languages)
const HAS_UV = childProcess.spawnSync("uv", ["--version"]).status === 0
if (!HAS_UV && process.env.CI) {
  throw new Error("uv is missing in CI; ci.yml installs it for this suite")
}

const PROBE = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("language_id", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
request = json.load(sys.stdin)
known = set(request["known"])
shipped = module.shipped_codes_of(request["shipped"])
print(json.dumps({tag: sorted(module.accepted_codes(tag.split("-")[0], shipped, known)) for tag in request["tags"]}))
`

/** accepted_codes for each tag, with `shipped` as the catalogs that ship. */
function acceptedCodes(tags, shipped) {
  const run = childProcess.spawnSync(
    "uv",
    [
      "run",
      "--quiet",
      "--no-project",
      "--python",
      ">=3.10,<3.13",
      "--with",
      "iso639-lang==2.6.3",
      "python",
      "-c",
      PROBE,
      SCRIPT,
    ],
    {
      input: JSON.stringify({ tags, shipped, known: GLOTLID.languages }),
      // No __pycache__ beside the script: an untracked file stops `eas update`.
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      encoding: "utf8",
      timeout: 120000,
    },
  )
  if (run.status !== 0) throw new Error(run.stderr || run.error?.message)
  return JSON.parse(run.stdout)
}

const WEB_TAGS = checks.catalogTagsIn(checks.REAL_PATHS.webMessagesDir)

describe("the GlotLID label fixture", () => {
  it("comes from the model revision that language-id.py pins", () => {
    const source = fs.readFileSync(SCRIPT, "utf8")
    const [, revision] = source.match(/^MODEL_REVISION = "([0-9a-f]{40})"$/m)
    expect(GLOTLID.model).toBe(`cis-lmu/glotlid model.bin@${revision}`)
  })
})
;(HAS_UV ? describe : describe.skip)("accepted_codes (language-id.py)", () => {
  it("accepts a macrolanguage member, unless that member ships alone", () => {
    const codes = acceptedCodes(
      ["ar", "ms", "sr", "xx"],
      ["ar", "ms", "id", "sr", "bs"],
    )
    expect(codes.ar).toEqual(expect.arrayContaining(["ara", "arb", "ary"]))
    expect(codes.ms).toContain("zsm")
    // `id` ships, so Indonesian text in the `ms` catalog is an error.
    expect(codes.ms).not.toContain("ind")
    expect(codes.sr).toEqual(["srp"])
    expect(codes.xx).toEqual([])
  })

  it("accepts the codes that GlotLID uses for no and tl", () => {
    const codes = acceptedCodes(["no", "tl"], WEB_TAGS)
    expect(codes.no).toEqual(expect.arrayContaining(["nob", "nno"]))
    expect(codes.tl).toContain("fil")
  })

  it("leaves only the languages that GlotLID has no label for unchecked", () => {
    const codes = acceptedCodes(WEB_TAGS, WEB_TAGS)
    const unchecked = WEB_TAGS.filter(
      (tag) => !codes[tag].some((code) => KNOWN.has(code)),
    )
    // GlotLID has no label for these. A new name means accepted_codes lost a
    // language, or web added a catalog GlotLID cannot label: check which.
    expect(unchecked).toEqual([
      "bjt",
      "chp",
      "den",
      "mdh",
      "mey-Latn",
      "mfv",
      "na",
      "quv",
      "sav",
      "xin",
    ])
  })
})
