/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// U8: summary.json is the one source of report.html and summary.md (KTD16).
// The fixtures are hand-built run inputs, because no producer exists yet.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { FAILURE_CLASSES, validateAgainstSchema } = require("../lib/contract")
const { readJson } = require("../lib/lists")
const {
  SummaryError,
  buildSummary,
  decideResult,
  renderReport,
  writeSummary,
} = require("../lib/report/summary")
const { applyRetention } = require("../lib/report/retention")

const FIXTURES = path.join(__dirname, "fixtures", "summaries")
const SCHEMA = readJson(
  path.join(__dirname, "..", "schema", "summary.schema.json"),
)
const OUTPUTS = ["summary.json", "report.html", "summary.md"]

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-report-"))
  tempDirs.push(dir)
  return dir
}

function fixture(name) {
  return readJson(path.join(FIXTURES, `${name}.json`))
}

const FIXTURE_NAMES = fs
  .readdirSync(FIXTURES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""))
  .sort()

// Builds, writes, and renders one input; returns the run folder and outputs.
function render(input) {
  const runDir = tempDir()
  writeSummary(runDir, buildSummary(input))
  renderReport(runDir)
  const files = Object.fromEntries(
    OUTPUTS.map((name) => [
      name,
      fs.readFileSync(path.join(runDir, name), "utf8"),
    ]),
  )
  return { runDir, files }
}

function htmlCounts(html) {
  return Object.fromEntries(
    [...html.matchAll(/data-count="(\w+)">(\d+)</g)].map((match) => [
      match[1],
      Number(match[2]),
    ]),
  )
}

const MARKDOWN_COUNT_ROWS = {
  "New failures": "new",
  "Flaky journeys": "flaky",
  "Known failures": "known",
  "Not run": "not_run",
  Passes: "pass",
}

function markdownCounts(markdown) {
  return Object.fromEntries(
    [...markdown.matchAll(/^\| ([A-Za-z ]+) \| (\d+) \|$/gm)]
      .filter((match) => Object.hasOwn(MARKDOWN_COUNT_ROWS, match[1]))
      .map((match) => [MARKDOWN_COUNT_ROWS[match[1]], Number(match[2])]),
  )
}

function articleOf(html, journey, deviceId) {
  const start = html.indexOf(
    `data-journey="${journey}" data-device="${deviceId}"`,
  )
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf("</article>", start))
}

describe("fixture summaries", () => {
  // Hand-written expectations: the result, the stop reason, and the scope.
  const EXPECTED = {
    labels: ["fail", "completed", "release"],
    partial: ["pass", "completed", "partial"],
    pass: ["pass", "completed", "release"],
    "stop-aborted": ["fail", "aborted", "release"],
    "stop-build-check-failed": ["fail", "build_check_failed", "release"],
    "stop-build-failed": ["fail", "build_failed", "release"],
    "stop-host-overload": ["fail", "host_overload", "release"],
    "stop-probe-failed": ["fail", "probe_failed", "release"],
    "stop-runner-error": ["fail", "runner_error", "release"],
    "stop-runner-killed": ["fail", "runner_killed", "release"],
    "stop-timeout": ["fail", "timeout", "release"],
    "stop-upstream-unavailable": ["fail", "upstream_unavailable", "release"],
  }

  it("has one fixture for a pass, the labels, a partial run, and each stop reason", () => {
    expect(FIXTURE_NAMES).toEqual(Object.keys(EXPECTED).sort())
    const stopReasons = new Set(
      Object.values(EXPECTED).map((entry) => entry[1]),
    )
    expect([...stopReasons].sort()).toEqual(
      [...SCHEMA.properties.stopReason.enum].sort(),
    )
  })

  it.each(FIXTURE_NAMES)(
    "%s builds a summary that the schema accepts",
    (name) => {
      const summary = buildSummary(fixture(name))
      expect(validateAgainstSchema(SCHEMA, summary)).toEqual([])
      const [result, stopReason, scope] = EXPECTED[name]
      expect([summary.result, summary.stopReason, summary.scope]).toEqual([
        result,
        stopReason,
        scope,
      ])
      expect(summary.exitCode).toBe(result === "pass" ? 0 : 1)
    },
  )

  it("names every failure class of the contract in the attempt schema", () => {
    expect(SCHEMA.$defs.failureClass.enum).toEqual([...FAILURE_CLASSES, null])
  })

  it("refuses an attempt with an absolute screenshot path", () => {
    const input = fixture("labels")
    input.attempts[2].screenshot = "/tmp/release-check/failed-step.png"
    expect(() => buildSummary(input)).toThrow(SummaryError)
  })
})

describe("decideResult (R26: every failure fails the run)", () => {
  function passWith(change) {
    const input = fixture("pass")
    change(input)
    return input
  }

  function failedAttempt(over) {
    return {
      ...fixture("pass").attempts[0],
      status: "failed",
      label: "new",
      class: "assertion_failed",
      failedStep: "Home content shows",
      error: "Assertion is false: id: home-body-live is visible",
      ...over,
    }
  }

  it("passes a completed run with only first-try passes and passed checks", () => {
    expect(decideResult(fixture("pass"))).toBe("pass")
  })

  it("does not let the speed numbers decide the result (R31)", () => {
    const input = fixture("pass")
    expect(input.speed.devices[1].failures).toHaveLength(1)
    expect(decideResult(input)).toBe("pass")
  })

  const FAILURE_KINDS = {
    "a journey failure": (input) => {
      input.attempts[0] = failedAttempt({})
    },
    "a crash": (input) => {
      input.attempts[0] = failedAttempt({ class: "app_crashed" })
    },
    "a known bug": (input) => {
      input.attempts[0] = failedAttempt({
        label: "known",
        class: "selector_not_found",
        knownBugTicket: "FORGE-2101",
      })
    },
    "a flaky journey": (input) => {
      input.attempts[0] = failedAttempt({
        label: "flaky",
        class: "device_unresponsive",
        restart: true,
      })
      input.attempts.push({ ...input.attempts[1], attempt: 2, label: "flaky" })
      input.attempts[input.attempts.length - 1].deviceId =
        input.attempts[0].deviceId
    },
    "a pass that the runner labels flaky": (input) => {
      input.attempts[0] = {
        ...input.attempts[0],
        label: "flaky",
        restart: true,
      }
    },
    "a journey that did not run": (input) => {
      input.attempts[0] = {
        ...input.attempts[0],
        status: "not_run",
        label: "not_run",
      }
    },
    "a screen list gap": (input) => {
      input.checks.screens.gaps.push({
        screen: "reader-settings",
        platform: "android",
      })
    },
    "a failed build check": (input) => {
      input.checks.build = {
        passed: false,
        findings: [
          {
            code: "UPDATE_CHANNEL_FOUND",
            message: "The iOS build has an update channel.",
            setting: null,
            file: null,
            deviceId: null,
          },
        ],
      }
    },
    "a failed log check": (input) => {
      input.checks.log.passed = false
    },
    "a failed settings probe": (input) => {
      input.checks.settingsProbe.passed = false
    },
    "a log check that did not run": (input) => {
      input.checks.log = null
    },
    "a build failure": (input) => {
      input.outcome.stopReason = "build_failed"
      input.attempts = []
      input.checks.build = null
    },
    "an empty scope": (input) => {
      input.attempts = []
    },
  }

  it.each(Object.keys(FAILURE_KINDS))("fails the run for %s", (kind) => {
    const input = passWith(FAILURE_KINDS[kind])
    expect(decideResult(input)).toBe("fail")
    expect(buildSummary(input)).toMatchObject({ result: "fail", exitCode: 1 })
  })

  const EARLY_STOPS = SCHEMA.properties.stopReason.enum.filter(
    (reason) => reason !== "completed",
  )

  it.each(EARLY_STOPS)("fails the run for the early stop %s", (reason) => {
    const input = passWith((value) => {
      value.outcome.stopReason = reason
    })
    expect(decideResult(input)).toBe("fail")
  })

  it("refuses an exit code that does not match the result", () => {
    const input = passWith((value) => {
      value.outcome.exitCode = 1
    })
    expect(() => buildSummary(input)).toThrow(
      "outcome.exitCode is 1, but result pass needs 0",
    )
  })
})

describe("counts per label", () => {
  it("are the same in summary.json, report.html, and summary.md", () => {
    const expected = { new: 2, flaky: 1, known: 1, not_run: 1, pass: 1 }
    const { files } = render(fixture("labels"))
    expect(JSON.parse(files["summary.json"]).counts).toEqual(expected)
    expect(htmlCounts(files["report.html"])).toEqual(expected)
    expect(markdownCounts(files["summary.md"])).toEqual(expected)
  })

  it("come from summary.json, and the renderers do not count again", () => {
    const runDir = tempDir()
    const summary = buildSummary(fixture("labels"))
    writeSummary(runDir, { ...summary, counts: { ...summary.counts, pass: 7 } })
    renderReport(runDir)
    const html = fs.readFileSync(path.join(runDir, "report.html"), "utf8")
    const markdown = fs.readFileSync(path.join(runDir, "summary.md"), "utf8")
    expect(htmlCounts(html).pass).toBe(7)
    expect(markdownCounts(markdown).pass).toBe(7)
  })
})

describe("report.html", () => {
  it("lists new failures, then flaky, known, not run, and passes (R29)", () => {
    const input = fixture("labels")
    expect(input.attempts[0].label).toBe("pass")
    const { files } = render(input)
    const order = ["new", "new", "flaky", "known", "not_run", "pass"]
    const labels = [
      ...files["report.html"].matchAll(/<article [^>]*data-label="(\w+)"/g),
    ].map((match) => match[1])
    expect(labels).toEqual(order)
    const journeys = JSON.parse(files["summary.json"]).journeys
    expect(journeys.map((entry) => entry.label)).toEqual(order)
    const failures = [
      ...files["summary.md"].matchAll(/^- \*\*([A-Za-z ]+)\*\*:/gm),
    ].map((match) => match[1])
    expect(failures).toEqual([
      "New failure",
      "New failure",
      "Flaky",
      "Known failure",
      "Not run",
    ])
  })

  it("opens with the run summary (R36)", () => {
    const html = render(fixture("labels")).files["report.html"]
    const order = [
      '<h1 id="headline"',
      'id="run-summary"',
      'id="journeys"',
      'id="speed"',
    ].map((marker) => html.indexOf(marker))
    expect(order.every((index) => index > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const runSummary = html.slice(order[1], order[2])
    for (const text of [
      "2bcf98e19a1b2c3d4e5f60718293a4b5c6d7e8f9",
      "Build check: passed",
      "Log check: passed",
      "Screen list gaps: 1",
      "reader-settings",
      "Admin rate-limit refusals: 3",
      "for-you-shelf",
      "FORGE-2050",
    ]) {
      expect(runSummary).toContain(text)
    }
  })

  it("shows each rate-limit refusal with the failure it caused (R36)", () => {
    const { files } = render(fixture("labels"))
    const refusals = JSON.parse(files["summary.json"]).server.rateLimitRefusals
    expect(refusals.map((refusal) => refusal.causedFailure)).toEqual([
      { label: "new", class: "rate_limited", failedStep: "Results show" },
      { label: "new", class: "rate_limited", failedStep: "Results show" },
      null,
    ])
    expect(files["report.html"]).toContain(
      "New failure: rate_limited at &quot;Results show&quot;",
    )
    expect(files["report.html"]).toContain("No failure")
  })

  it("shows each failure's label, screenshot, step times, crash, restart, and steps not run (R37)", () => {
    const html = render(fixture("labels")).files["report.html"]
    const crash = articleOf(html, "open-video-play", "iphone-se")
    for (const text of [
      "New failure",
      'href="attempts/open-video-play/iphone-se/1/failed-step.png"',
      "Open the first Home tile",
      "900 ms",
      "4.1 s",
      "The app crashed.",
      "Pause, seek, and close",
    ]) {
      expect(crash).toContain(text)
    }
    const flaky = articleOf(html, "explore-five-clips", "android-phone")
    expect(flaky).toContain("The runner restarted the device")
    expect(flaky).toContain("Swipe to clip 4")
    const known = articleOf(html, "bible-change-chapter", "iphone-se")
    expect(known).toContain("Known failure")
    expect(known).toContain("FORGE-2101")
  })

  it("shows the speed numbers as information only (R31)", () => {
    const html = render(fixture("pass")).files["report.html"]
    const speed = html.slice(html.indexOf('id="speed"'))
    expect(speed).toContain("Speed (information only)")
    expect(speed).toContain("2.1 s (1.9 s to 2.6 s, 3 samples)")
    expect(speed).toContain(
      "The third cold launch did not show Home within 60 seconds.",
    )
  })

  it("escapes every value, so a value cannot add markup", () => {
    const input = fixture("labels")
    input.attempts[7].error = '<script>alert("x")</script>'
    const html = render(input).files["report.html"]
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
  })
})

describe("headline", () => {
  it("says that a partial run is not a release result", () => {
    const { files } = render(fixture("partial"))
    expect(files["report.html"]).toMatch(
      /<h1 id="headline"[^>]*>Partial check: pass\. This is not a release result\.<\/h1>/,
    )
    expect(files["summary.md"].split("\n")[0]).toBe(
      "# Partial check: pass. This is not a release result.",
    )
  })

  it("does not say it for a release run", () => {
    const { files } = render(fixture("pass"))
    expect(files["report.html"]).toContain(
      '<h1 id="headline" data-scope="release">Release check: pass</h1>',
    )
    for (const name of ["report.html", "summary.md"]) {
      expect(files[name]).not.toContain("not a release result")
    }
  })

  it.each(FIXTURE_NAMES.filter((name) => name.startsWith("stop-")))(
    "%s shows its stop reason and completed phases (R38)",
    (name) => {
      const input = fixture(name)
      const { files } = render(input)
      for (const output of ["report.html", "summary.md"]) {
        expect(files[output]).toContain(input.outcome.stopReason)
        expect(files[output]).toContain(
          input.outcome.completedPhases.join(", "),
        )
      }
    },
  )
})

describe("what no output contains", () => {
  it.each(FIXTURE_NAMES)("%s has no release decision wording", (name) => {
    const { files } = render(fixture(name))
    for (const output of OUTPUTS) {
      expect(files[output]).not.toMatch(/\bship\b/i)
      expect(files[output]).not.toMatch(/do not ship/i)
    }
  })

  it.each(FIXTURE_NAMES)("%s has no home folder path", (name) => {
    const { files } = render(fixture(name))
    for (const output of OUTPUTS) {
      expect(files[output]).not.toContain("/Users/")
    }
  })

  it("replaces a planted home folder path with ~", () => {
    const input = fixture("labels")
    expect(JSON.stringify(input)).toContain("/Users/qa-engineer/")
    const { files } = render(input)
    // summary.md does not print attempt errors.
    for (const output of ["summary.json", "report.html"]) {
      expect(files[output]).toContain(
        "~/Library/Logs/DiagnosticReports/forgewatch-2026-10-22.ips",
      )
    }
  })

  it("leaves out a secret value that a finding carries by mistake", () => {
    // Built at run time, so no token-shaped text is in the repo.
    const token = `pub${"0123456789abcdef".repeat(2)}`
    const input = fixture("stop-build-check-failed")
    input.checks.build.findings[0].message = `The Android bundle holds ${token}.`
    const { files } = render(input)
    for (const output of OUTPUTS) {
      expect(files[output]).not.toContain(token)
    }
    expect(files["summary.json"]).toContain("holds [redacted].")
    expect(files["report.html"]).toContain("holds [redacted].")
    expect(files["summary.md"]).toContain("holds \\[redacted\\].")
  })
})

describe("relative links", () => {
  it("open from a copy of the run folder", () => {
    const input = fixture("labels")
    const { runDir } = render(input)
    const shots = input.attempts
      .map((attempt) => attempt.screenshot)
      .filter((shot) => shot !== null)
    for (const shot of shots) {
      fs.mkdirSync(path.dirname(path.join(runDir, shot)), { recursive: true })
      fs.writeFileSync(path.join(runDir, shot), "png")
    }
    const copy = path.join(tempDir(), "zipped-run")
    fs.cpSync(runDir, copy, { recursive: true })
    fs.rmSync(runDir, { recursive: true, force: true })

    const html = fs.readFileSync(path.join(copy, "report.html"), "utf8")
    const markdown = fs.readFileSync(path.join(copy, "summary.md"), "utf8")
    const htmlLinks = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map(
      (match) => match[1].replace(/&amp;/g, "&"),
    )
    const markdownLinks = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(
      (match) => match[1],
    )
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
    const fileLinks = [...htmlLinks, ...markdownLinks].filter(
      (link) => !link.startsWith("#"),
    )
    expect(fileLinks.length).toBeGreaterThanOrEqual(shots.length * 2)
    for (const link of [...htmlLinks, ...markdownLinks]) {
      expect(link).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
      expect(link).not.toMatch(/^[/~]/)
      if (link.startsWith("#")) {
        expect(ids.has(link.slice(1))).toBe(true)
      } else {
        const target = path.join(
          copy,
          ...link.split("/").map(decodeURIComponent),
        )
        expect(fs.existsSync(target)).toBe(true)
      }
    }
  })
})

describe("writeSummary", () => {
  it("replaces summary.json and leaves no temporary file", () => {
    const runDir = tempDir()
    writeSummary(runDir, buildSummary(fixture("pass")))
    const labels = buildSummary(fixture("labels"))
    writeSummary(runDir, labels)
    expect(fs.readdirSync(runDir)).toEqual(["summary.json"])
    expect(readJson(path.join(runDir, "summary.json"))).toEqual(labels)
  })

  it("does not replace summary.json with a summary that the schema refuses", () => {
    const runDir = tempDir()
    const valid = buildSummary(fixture("pass"))
    writeSummary(runDir, valid)
    expect(() => writeSummary(runDir, { ...valid, result: "maybe" })).toThrow(
      SummaryError,
    )
    expect(readJson(path.join(runDir, "summary.json"))).toEqual(valid)
    expect(fs.readdirSync(runDir)).toEqual(["summary.json"])
  })
})

describe("applyRetention", () => {
  function reportedRun(home, runId, startedAt) {
    const runDir = path.join(home, "runs", runId)
    fs.mkdirSync(runDir, { recursive: true })
    const input = fixture("pass")
    input.identity = { ...input.identity, runId, startedAt }
    writeSummary(runDir, buildSummary(input))
  }

  it("removes the sixth-newest run folder and names the newest in latest.json", () => {
    const home = tempDir()
    const runs = [
      ["2026-10-17T09-00-00Z-0001", "2026-10-17T09:00:00.000Z"],
      ["2026-10-18T09-00-00Z-0002", "2026-10-18T09:00:00.000Z"],
      ["2026-10-19T09-00-00Z-0003", "2026-10-19T09:00:00.000Z"],
      ["2026-10-20T09-00-00Z-0004", "2026-10-20T09:00:00.000Z"],
      ["2026-10-21T09-00-00Z-0005", "2026-10-21T09:00:00.000Z"],
      ["2026-10-22T09-00-00Z-0006", "2026-10-22T09:00:00.000Z"],
    ]
    for (const [runId, startedAt] of runs) reportedRun(home, runId, startedAt)
    // A run that is still going has no summary.json yet.
    fs.mkdirSync(path.join(home, "runs", "2026-10-22T10-00-00Z-0007"))

    const outcome = applyRetention(home)

    expect(outcome.removed).toEqual(["2026-10-17T09-00-00Z-0001"])
    expect(fs.readdirSync(path.join(home, "runs")).sort()).toEqual([
      "2026-10-18T09-00-00Z-0002",
      "2026-10-19T09-00-00Z-0003",
      "2026-10-20T09-00-00Z-0004",
      "2026-10-21T09-00-00Z-0005",
      "2026-10-22T09-00-00Z-0006",
      "2026-10-22T10-00-00Z-0007",
    ])
    expect(readJson(path.join(home, "latest.json"))).toEqual({
      schemaVersion: 1,
      runId: "2026-10-22T09-00-00Z-0006",
      runDir: "runs/2026-10-22T09-00-00Z-0006",
    })
  })
})
