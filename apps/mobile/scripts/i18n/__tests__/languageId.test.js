/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// accepted_codes in language-id.py, run by real Python through uv. The command
// suite fakes uv, so this suite is the one that runs the verdict rules. It
// skips where uv is not installed; the model itself is never loaded.
const childProcess = require("child_process")
const path = require("path")
const checks = require("../lib/catalogChecks")
const GLOTLID = require("./fixtures/glotlid-languages.json")

const SCRIPT = path.join(__dirname, "../language-id.py")
const KNOWN = new Set(GLOTLID.languages)
const HAS_UV = childProcess.spawnSync("uv", ["--version"]).status === 0

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
    // GlotLID (pinned revision) has no label for these, so the report gives
    // them an info finding. A new name here means accepted_codes lost one.
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
