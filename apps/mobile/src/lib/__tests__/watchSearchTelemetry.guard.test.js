// Plain JS (like watchSearchInput.guard.test.js): the RN tsconfig has no
// Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: feat-335 retired mobile's pre-parity search telemetry — the
// "watch_search_failed" log, the bare datadogLog "watch_search" emit, and the
// "search.result_clicked" action name. None may return to src/ or app/.

// One pattern per retired shape so a failure shows which emit came back.
// `\bsearch\.` cannot match `watch_search.` — the `_` before `search` is a
// word character, so no word boundary exists there.
const RETIRED_EMITS = [
  // The retired failure message, either quote style.
  /["']watch_search_failed["']/,
  // The retired click-action name; the successor is watch_search.result_clicked.
  /\bsearch\.result_clicked/,
  // The retired bare-message emit CALL — the "watch_search" attribute VALUE
  // (watchSearchLog.ts event_name) has no call prefix, so it never matches.
  /datadogLog\.(info|warn)\(\s*["']watch_search["']/,
]

// LEVEL pin, content-wide because the call spans lines: the failure emits MUST
// stay at warn — the native SDK forwards error/critical logs' FULL attribute
// bag (incl. watch_search.query) into RUM errors, outside the R43 Logs posture.
const RETIRED_CONTENT_EMITS = [/datadogLog\.error\(\s*WATCH_SEARCH_LOG_MESSAGE/]

// Pure detector over [{ relative, content }] so positive/negative controls can
// prove each pattern branch, not just that today's tree is clean.
function findRetiredTelemetryEmits(entries) {
  return entries
    .filter(
      (entry) =>
        entry.content.split("\n").some((line) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false
          return RETIRED_EMITS.some((pattern) => pattern.test(line))
        }) ||
        RETIRED_CONTENT_EMITS.some((pattern) => pattern.test(entry.content)),
    )
    .map((entry) => entry.relative)
}

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("watch search telemetry retirement stays retired", () => {
  it("no retired search-telemetry emits in src/ or app/", () => {
    const root = path.resolve(__dirname, "../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
    ]
    // A broken root resolution or empty scan must not vacuously pass.
    expect(files.length).toBeGreaterThan(50)
    const entries = files.map((file) => ({
      relative: path.relative(root, file),
      content: fs.readFileSync(file, "utf8"),
    }))
    expect(findRetiredTelemetryEmits(entries)).toEqual([])
  })

  it("positive control: each retired shape is flagged on its own", () => {
    // One fixture per pattern branch — no fixture satisfies two patterns at
    // once — so deleting any one pattern fails at least one fixture here.
    const offenders = findRetiredTelemetryEmits([
      {
        relative: "app/(tabs)/watch.tsx",
        content: 'datadogLog.warn("watch_search_failed", { reason: code })',
      },
      {
        relative: "src/lib/telemetry/FailedSingleQuote.ts",
        content: "log('watch_search_failed')",
      },
      {
        relative: "src/lib/telemetry/OldAction.ts",
        content: 'reportDatadogAction("search.result_clicked", context)',
      },
      {
        relative: "src/lib/telemetry/BareInfo.ts",
        content: 'datadogLog.info("watch_search", attributes)',
      },
      {
        relative: "src/lib/telemetry/BareWarnSingleQuote.ts",
        content: "datadogLog.warn('watch_search', attributes)",
      },
      {
        // Comment lines are skipped: prose about the retirement never flags.
        relative: "src/lib/telemetry/Comment.ts",
        content: '// the retired datadogLog.info("watch_search", ...) emit',
      },
      {
        // The level pin: error + the shared message flags even across lines.
        relative: "src/lib/telemetry/ErrorLevel.ts",
        content:
          "datadogLog.error(\n  WATCH_SEARCH_LOG_MESSAGE,\n  buildWatchSearchLogAttributes(input),\n)",
      },
    ])
    expect(offenders).toEqual([
      "app/(tabs)/watch.tsx",
      "src/lib/telemetry/FailedSingleQuote.ts",
      "src/lib/telemetry/OldAction.ts",
      "src/lib/telemetry/BareInfo.ts",
      "src/lib/telemetry/BareWarnSingleQuote.ts",
      "src/lib/telemetry/ErrorLevel.ts",
    ])
  })

  it("negative control: the current telemetry shapes do not flag", () => {
    expect(
      findRetiredTelemetryEmits([
        {
          // The NEW shared action name — the `_` blocks \bsearch\. matching.
          relative: "src/lib/watchSearchRum.ts",
          content:
            'export const WATCH_SEARCH_RESULT_CLICKED_ACTION = "watch_search.result_clicked"',
        },
        {
          // The NEW shared-message emit uses the constant, not a bare string.
          relative: "app/(tabs)/watch.tsx",
          content:
            "datadogLog.info(WATCH_SEARCH_LOG_MESSAGE, buildWatchSearchLogAttributes(input))",
        },
        {
          // "watch_search" as an attribute VALUE is not the emit call shape.
          relative: "src/lib/watchSearchLog.ts",
          content: '    "watch_search.event_name": "watch_search",',
        },
        {
          // Different log name; the action pattern anchors on result_clicked.
          relative: "app/(tabs)/watch.tsx",
          content: 'datadogLog.info("search.prefetch", { query_length: 3 })',
        },
        {
          // Bare wire enum value carries no retired `search.` prefix.
          relative: "src/lib/watchSearchEvents.ts",
          content: '  eventType: "result_clicked",',
        },
        {
          // The CURRENT failure emit: warn + the shared message stays legal.
          relative: "app/(tabs)/watch.tsx",
          content:
            "datadogLog.warn(\n  WATCH_SEARCH_LOG_MESSAGE,\n  buildWatchSearchLogAttributes(input),\n)",
        },
        {
          // error level with a non-search message is ordinary house telemetry.
          relative: "src/hooks/useManagedVideoPlayer.ts",
          content: 'datadogLog.error("video.swap_failed", { content_id: id })',
        },
      ]),
    ).toEqual([])
  })
})
