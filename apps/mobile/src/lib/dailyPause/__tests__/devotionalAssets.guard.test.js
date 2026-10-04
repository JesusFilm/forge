// Plain JS (like the other guards here): the RN tsconfig has no Node types, and
// this guard reads files off disk and asks git what it tracks.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")

// KTD3: the two encoded videos never enter git, and only the branch-only
// .easignore puts them in the EAS upload. While .easignore exists, eas-cli
// reads no .gitignore, so the .easignore rules alone keep secrets out.

const REPO_ROOT = path.resolve(__dirname, "../../../../../..")
const EASIGNORE = path.join(REPO_ROOT, ".easignore")
const TIMELINE = path.join(__dirname, "..", "devotionalTimeline.json")
const OUTPUTS = [
  "apps/mobile/assets/devotionals/pharisee.mp4",
  "apps/mobile/assets/devotionals/lamp.mp4",
]
const DEVOTIONALS = ["pharisee", "lamp"]
const PART_ORDER = ["film", "teaching", "prayer"]

/** Git's output; `check-ignore` exits 1 when it matches no path. */
function git(args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
  return result.stdout
}

function easignoreRules() {
  return fs
    .readFileSync(EASIGNORE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
}

/** Each range out of order in the list, as text; empty when they ascend. */
function orderProblems(label, ranges) {
  const problems = []
  ranges.forEach(([name, range], index) => {
    if (!(range.startSec >= 0 && range.startSec < range.endSec)) {
      problems.push(`${label} ${name} does not end after it starts`)
    }
    const previous = ranges[index - 1]
    if (previous && previous[1].endSec > range.startSec) {
      problems.push(`${label} ${name} starts before ${previous[0]} ends`)
    }
  })
  return problems
}

describe("bundled devotional videos (KTD3)", () => {
  it("git tracks neither output video", () => {
    expect(git(["ls-files", "--", ...OUTPUTS])).toBe("")
  })

  it("git ignores both output videos", () => {
    const ignored = git(["check-ignore", "--no-index", "--", ...OUTPUTS])
    expect(ignored.trim().split("\n").sort()).toEqual([...OUTPUTS].sort())
  })

  it(".easignore keeps out every .env file and node_modules", () => {
    const rules = easignoreRules()
    expect(rules).toEqual(expect.arrayContaining([".env", ".env.*"]))
    expect(rules.filter((rule) => /^node_modules\/?$/.test(rule))).not.toEqual(
      [],
    )
  })

  it(".easignore includes again only the two output videos", () => {
    const negations = easignoreRules().filter((rule) => rule.startsWith("!"))
    expect(negations.sort()).toEqual(OUTPUTS.map((file) => `!${file}`).sort())
  })

  // No trailing slash: eas-cli tests a folder path without one, so `ios/`
  // drops the files but still copies an empty `ios` folder into the upload.
  it(".easignore drops the local native projects", () => {
    const rules = easignoreRules()
    const kept = ["apps/mobile/ios", "apps/mobile/android"].filter(
      (folder) => !rules.includes(folder) && !rules.includes(`/${folder}`),
    )
    expect(kept).toEqual([])
  })

  describe("timeline", () => {
    const timeline = JSON.parse(fs.readFileSync(TIMELINE, "utf8"))

    it("describes each devotional with its three named parts", () => {
      expect(Object.keys(timeline).sort()).toEqual([...DEVOTIONALS].sort())
      for (const key of DEVOTIONALS) {
        expect(Object.keys(timeline[key].parts)).toEqual(PART_ORDER)
      }
    })

    it.each(DEVOTIONALS)("%s has ascending cut points", (key) => {
      const { parts, skipped } = timeline[key]
      const problems = [
        ...orderProblems(
          "part",
          PART_ORDER.map((name) => [name, parts[name]]),
        ),
        ...orderProblems(
          "skipped range",
          skipped.map((range, index) => [String(index), range]),
        ),
      ]
      expect(problems).toEqual([])
    })

    it.each(DEVOTIONALS)("%s plays no part of a skipped range", (key) => {
      const { parts, skipped } = timeline[key]
      const overlaps = []
      for (const name of PART_ORDER) {
        for (const range of skipped) {
          const part = parts[name]
          if (part.startSec < range.endSec && range.startSec < part.endSec) {
            overlaps.push(`${name} overlaps ${range.startSec}-${range.endSec}`)
          }
        }
      }
      expect(overlaps).toEqual([])
    })
  })
})
