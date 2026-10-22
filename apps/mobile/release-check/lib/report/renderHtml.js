"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// report.html (R29, R36, R37): plain HTML with inline CSS and no script. Every
// value goes through escapeHtml, and every link is relative to the run folder.

const {
  ATTEMPT_STATUS_TEXT,
  CLASS_TEXT,
  LABEL_NAMES,
  LABEL_ORDER,
  LABEL_TITLES,
  STOP_REASON_TEXT,
  actionText,
  causedFailureText,
  checkStatusText,
  durationText,
  formatMs,
  headlineOf,
  listText,
  relativeHref,
} = require("./summary")

const ENTITIES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char])
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1c1917; --bg: #fafaf9; --card: #ffffff;
  --muted: #57534e; --line: #d6d3d1; --pass: #166534; --fail: #b91c1c; --warn: #a16207; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #f5f5f4; --bg: #1c1917; --card: #292524; --muted: #a8a29e;
    --line: #44403c; --pass: #4ade80; --fail: #f87171; --warn: #facc15; }
}
body { margin: 0; color: var(--fg); background: var(--bg);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
header { background: var(--card); border-left: 6px solid var(--fail); padding: 8px 16px; }
header.result-pass { border-left-color: var(--pass); }
h1 { font-size: 26px; margin: 0 0 8px; }
h2 { margin-top: 32px; border-bottom: 1px solid var(--line); }
nav ul { display: flex; flex-wrap: wrap; gap: 16px; list-style: none; padding: 0; }
.table { overflow-x: auto; }
table { border-collapse: collapse; margin: 8px 0 16px; width: 100%; }
th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: var(--card); }
dl.facts { display: grid; gap: 4px 16px; grid-template-columns: max-content 1fr; }
dt { font-weight: 600; }
dd { margin: 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.journey { background: var(--card); border: 1px solid var(--line); border-left-width: 6px;
  margin: 12px 0; padding: 8px 16px; }
.label-new { border-left-color: var(--fail); }
.label-flaky, .label-not_run { border-left-color: var(--warn); }
.label-known { border-left-color: var(--muted); }
.label-pass { border-left-color: var(--pass); }
.badge { border: 1px solid currentColor; border-radius: 999px; font-size: 13px;
  margin-left: 8px; padding: 2px 8px; }
.attempt { border-top: 1px dashed var(--line); margin-top: 8px; padding-top: 8px; }
h5 { font-size: 15px; margin: 4px 0 8px; }
img { border: 1px solid var(--line); height: auto; max-width: 240px; }
.muted { color: var(--muted); }
`

function text(value) {
  return escapeHtml(value === null || value === undefined ? "None" : value)
}

function code(value) {
  return `<code>${text(value)}</code>`
}

// Each cell is plain text, or { html } for markup that is already escaped.
function table(headers, rows, empty) {
  if (rows.length === 0) return `<p class="muted">${escapeHtml(empty)}</p>`
  const head = headers
    .map((header) => `<th scope="col">${escapeHtml(header)}</th>`)
    .join("")
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td>${cell?.html ?? text(cell)}</td>`).join("")}</tr>`,
    )
    .join("\n")
  return `<div class="table"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`
}

function facts(pairs) {
  const items = pairs
    .map(([term, html]) => `<dt>${escapeHtml(term)}</dt><dd>${html}</dd>`)
    .join("\n")
  return `<dl class="facts">\n${items}\n</dl>`
}

function findingsTable(findings) {
  return table(
    ["Code", "Message", "Setting", "File", "Device"],
    findings.map((finding) => [
      { html: code(finding.code) },
      finding.message,
      finding.setting,
      finding.file,
      finding.deviceId,
    ]),
    "No findings.",
  )
}

function checkSection(title, check, extra = "") {
  const status = checkStatusText(check)
  const findings = check === null ? "" : findingsTable(check.findings)
  return `<h3>${escapeHtml(title)}: ${escapeHtml(status)}</h3>\n${findings}${extra}`
}

function countTable(counts, firstHeader) {
  return table(
    [firstHeader, "Requests"],
    Object.entries(counts).map(([name, count]) => [name, String(count)]),
    "No requests.",
  )
}

function header(summary) {
  const headline = headlineOf(summary)
  const lines = headline.lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n")
  return `<header class="result-${escapeHtml(summary.result)}">\n<h1 id="headline" data-scope="${escapeHtml(summary.scope)}">${escapeHtml(headline.title)}</h1>\n${lines}\n</header>`
}

function nav() {
  const links = [
    ["run-summary", "Run summary"],
    ["journeys", "Journeys on devices"],
    ["speed", "Speed"],
    ["actions", "Proposed list changes"],
    ["details", "Run details"],
  ]
  const items = links
    .map(([id, label]) => `<li><a href="#${id}">${escapeHtml(label)}</a></li>`)
    .join("")
  return `<nav aria-label="Report sections"><ul>${items}</ul></nav>`
}

function runSummary(summary) {
  const { checks, server } = summary
  const counts = LABEL_ORDER.map(
    (label) =>
      `<tr><td>${escapeHtml(LABEL_TITLES[label])}</td><td data-count="${label}">${escapeHtml(summary.counts[label])}</td></tr>`,
  ).join("\n")
  const log =
    checks.log === null
      ? ""
      : `<h4>Requests from each device</h4>\n${countTable(checks.log.perDevice, "Device")}\n<h4>Requests by route in the log check</h4>\n${countTable(checks.log.routes, "Route")}`
  const screens = checks.screens
  const screenList =
    screens === null
      ? `<h3>Screen list: did not run</h3>`
      : [
          `<h3>Screen list gaps: ${escapeHtml(screens.gaps.length)}</h3>`,
          table(
            ["Screen", "Platform"],
            screens.gaps.map((gap) => [gap.screen, gap.platform]),
            "Every screen has a journey on each platform that shows it.",
          ),
          `<h4>Screens that a failed journey did not reach</h4>`,
          table(
            ["Screen", "Device"],
            screens.notReached.map((entry) => [entry.screen, entry.deviceId]),
            "None.",
          ),
          `<h4>Screens that a setting hides on a platform</h4>`,
          table(
            ["Screen", "Platform", "Setting"],
            screens.skippedPlatforms.map((entry) => [
              entry.screen,
              entry.platform,
              entry.setting,
            ]),
            "None.",
          ),
        ].join("\n")
  return [
    `<section id="run-summary">`,
    `<h2>Run summary</h2>`,
    facts([
      ["Commit", code(summary.commit)],
      ["Scope", text(summary.scope)],
      ["Result", text(summary.result)],
      [
        "Stop reason",
        `${code(summary.stopReason)} ${text(STOP_REASON_TEXT[summary.stopReason])}`,
      ],
      ["Completed phases", text(listText(summary.completedPhases))],
      ["Started", text(summary.startedAt)],
      ["Ended", text(summary.endedAt)],
      ["Duration", text(durationText(summary))],
      ["Run ID", code(summary.runId)],
    ]),
    `<h3>Journeys on devices for each label</h3>`,
    `<div class="table"><table class="counts">\n<thead><tr><th scope="col">Label</th><th scope="col">Count</th></tr></thead>\n<tbody>\n${counts}\n</tbody>\n</table></div>`,
    checkSection("Build check", checks.build),
    checkSection("Log check", checks.log, log),
    checkSection("Settings probe", checks.settingsProbe),
    screenList,
    `<h3>Admin rate-limit refusals: ${escapeHtml(server.rateLimitRefusals.length)}</h3>`,
    table(
      ["Time", "Field", "Device", "Journey", "Attempt", "Failure it caused"],
      server.rateLimitRefusals.map((refusal) => [
        refusal.ts,
        refusal.field,
        refusal.deviceId,
        refusal.journey,
        refusal.attempt === null ? null : String(refusal.attempt),
        causedFailureText(refusal.causedFailure),
      ]),
      "Admin refused no request.",
    ),
    `<h3>Server requests by route</h3>`,
    countTable(server.routes, "Route"),
    `<h3>Device restarts</h3>`,
    table(
      ["Device", "Time", "Reason"],
      summary.restarts.map((restart) => [
        restart.deviceId,
        restart.ts,
        restart.reason,
      ]),
      "The runner restarted no device.",
    ),
    `<h3>Not-Tested List</h3>`,
    table(
      ["Kind", "Target", "Platforms", "Reason"],
      summary.notTested.map((entry) => [
        entry.kind,
        entry.target,
        listText(entry.platforms),
        entry.reason,
      ]),
      "The run used no Not-Tested List entry.",
    ),
    `<h3>Known-Bug entries to remove</h3>`,
    summary.staleKnownBugs.length === 0
      ? ""
      : `<p>These journeys now pass. Remove each entry from apps/mobile/release-check/config/known-bugs.json.</p>`,
    table(
      ["Journey", "Devices", "Step", "Check", "Ticket"],
      summary.staleKnownBugs.map((entry) => [
        entry.journey,
        listText(entry.devices),
        entry.step,
        entry.check,
        entry.ticket,
      ]),
      "No Known-Bug entry has a journey that now passes.",
    ),
    `</section>`,
  ].join("\n")
}

function screenshot(attempt) {
  if (attempt.screenshot === null) return `<p class="muted">No screenshot.</p>`
  const href = escapeHtml(relativeHref(attempt.screenshot))
  return `<p><a href="${href}"><img src="${href}" alt="Screenshot of the failed step"></a><br><a href="${href}">${text(attempt.screenshot)}</a></p>`
}

function attemptDetails(attempt) {
  const status = ATTEMPT_STATUS_TEXT[attempt.status]
  const heading = `<h5>Attempt ${escapeHtml(attempt.attempt)}: ${escapeHtml(status)}</h5>`
  if (attempt.status === "not_run") {
    return `<div class="attempt">\n${heading}\n<p>This journey did not run.</p>\n</div>`
  }
  const pairs = [
    [
      "Failure class",
      attempt.class === null
        ? text(null)
        : `${code(attempt.class)} ${text(CLASS_TEXT[attempt.class])}`,
    ],
    ["Failed step", text(attempt.failedStep)],
    [
      "Error",
      attempt.error === null
        ? text(null)
        : `<pre>${escapeHtml(attempt.error)}</pre>`,
    ],
    [
      "Device restart",
      attempt.restart
        ? "Yes. The runner restarted the device during this attempt."
        : "No",
    ],
  ]
  if (attempt.knownBugTicket !== null) {
    pairs.push(["Known-Bug ticket", text(attempt.knownBugTicket)])
  }
  const notRun =
    attempt.notRunSteps.length === 0
      ? `<p class="muted">No step was left out.</p>`
      : `<p>Steps that did not run:</p>\n<ul>${attempt.notRunSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>`
  return [
    `<div class="attempt">`,
    heading,
    facts(pairs),
    attempt.status === "failed" ? screenshot(attempt) : "",
    table(
      ["Step", "Time"],
      attempt.stepTimes.map((step) => [step.label, formatMs(step.ms)]),
      "No step times.",
    ),
    notRun,
    `</div>`,
  ].join("\n")
}

function journeyEntry(entry) {
  const title = `${escapeHtml(entry.journey)} on ${escapeHtml(entry.deviceId)}`
  const badge = `<span class="badge">${escapeHtml(LABEL_NAMES[entry.label])}</span>`
  const open = `<article class="journey label-${escapeHtml(entry.label)}" data-label="${escapeHtml(entry.label)}" data-journey="${escapeHtml(entry.journey)}" data-device="${escapeHtml(entry.deviceId)}">\n<h4>${title}${badge}</h4>`
  if (entry.label === "pass") {
    const total = entry.attempts.flatMap((attempt) => attempt.stepTimes)
    const ms = total.reduce((sum, step) => sum + step.ms, 0)
    return `${open}\n<p>Passed on attempt 1 in ${escapeHtml(formatMs(ms))}.</p>\n</article>`
  }
  return `${open}\n${entry.attempts.map(attemptDetails).join("\n")}\n</article>`
}

function journeysSection(summary) {
  const groups = LABEL_ORDER.map((label) => {
    const entries = summary.journeys.filter((entry) => entry.label === label)
    if (entries.length === 0) return ""
    return `<h3 id="label-${label}">${escapeHtml(LABEL_TITLES[label])} (${escapeHtml(summary.counts[label])})</h3>\n${entries.map(journeyEntry).join("\n")}`
  })
  const body =
    summary.journeys.length === 0
      ? `<p class="muted">No journey ran.</p>`
      : groups.join("\n")
  return `<section id="journeys">\n<h2>Journeys on devices</h2>\n${body}\n</section>`
}

function statText(stat) {
  if (stat === null) return null
  return `${formatMs(stat.median)} (${formatMs(stat.min)} to ${formatMs(stat.max)}, ${stat.samples.length} samples)`
}

function speedSection(summary) {
  const intro = `<p>Information only. These numbers do not decide pass or fail.</p>`
  const body =
    summary.speed === null
      ? `<p class="muted">The speed pass did not run.</p>`
      : table(
          [
            "Device",
            "Cold launch",
            "Home content",
            "First video frame",
            "Peak memory",
            "Failures",
          ],
          summary.speed.devices.map((device) => [
            device.deviceId,
            statText(device.coldLaunchMs),
            statText(device.homeContentMs),
            statText(device.firstFrameMs),
            device.peakMemoryMb === null ? null : `${device.peakMemoryMb} MB`,
            listText(device.failures),
          ]),
          "No device has speed numbers.",
        )
  return `<section id="speed">\n<h2>Speed (information only)</h2>\n${intro}\n${body}\n</section>`
}

function actionsSection(summary) {
  const items = summary.proposedActions
    .map(
      (action) =>
        `<li>${code(action.type)} ${escapeHtml(actionText(action))} Reason: ${escapeHtml(action.reason)}</li>`,
    )
    .join("\n")
  const body =
    summary.proposedActions.length === 0
      ? `<p class="muted">The runner proposes no list change.</p>`
      : `<p>The runner does not apply these. The mobile owner approves each change through a commit.</p>\n<ul>\n${items}\n</ul>`
  return `<section id="actions">\n<h2>Proposed list changes</h2>\n${body}\n</section>`
}

function digestTable(digests, firstHeader) {
  return table(
    [firstHeader, "SHA-256"],
    Object.entries(digests).map(([name, digest]) => [
      name,
      { html: code(digest) },
    ]),
    "None.",
  )
}

function detailsSection(summary) {
  const pins = Object.entries(summary.devicePins).flatMap(([device, values]) =>
    Object.entries(values).map(([pin, value]) => [
      device,
      pin,
      value === null ? null : String(value),
    ]),
  )
  return [
    `<section id="details">`,
    `<h2>Run details</h2>`,
    facts([["Mac time zone", text(summary.macTimeZone)]]),
    `<h3>Tool versions</h3>`,
    table(
      ["Tool", "Version"],
      Object.entries(summary.toolVersions),
      "No tool versions.",
    ),
    `<h3>Device pins</h3>`,
    table(["Device", "Pin", "Value"], pins, "No device pins."),
    `<h3>Build input digests</h3>`,
    digestTable(summary.inputDigests, "Input"),
    `<h3>List digests</h3>`,
    digestTable(summary.listDigests, "List"),
    `</section>`,
  ].join("\n")
}

/** The whole report page, from a checked summary.json only. */
function renderHtml(summary) {
  const body = [
    header(summary),
    nav(),
    runSummary(summary),
    journeysSection(summary),
    speedSection(summary),
    actionsSection(summary),
    detailsSection(summary),
  ].join("\n")
  const title = `${headlineOf(summary).title} (${summary.runId})`
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`
}

module.exports = { escapeHtml, renderHtml }
