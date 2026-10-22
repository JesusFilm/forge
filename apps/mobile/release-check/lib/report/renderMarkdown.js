"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// summary.md: the short text form of the report for a chat or a ticket. It
// lists every failure, and report.html lists every journey on every device.

const {
  ATTEMPT_STATUS_TEXT,
  LABEL_NAMES,
  LABEL_ORDER,
  LABEL_TITLES,
  REPORT_FILE,
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

/** Plain text that Markdown shows as written, on one line. */
function md(value) {
  const textValue = value === null || value === undefined ? "None" : value
  return String(textValue)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/([\\`*_[\]<>|#~])/g, "\\$1")
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function checkLine(title, check) {
  const status = checkStatusText(check)
  if (check === null) return `- ${title}: ${status}`
  return `- ${title}: ${status} (${plural(check.findings.length, "finding", "findings")})`
}

function findingLines(title, check) {
  if (check === null) return []
  return check.findings.map((finding) => {
    const setting =
      finding.setting === null ? "" : ` Setting: ${md(finding.setting)}.`
    const device =
      finding.deviceId === null ? "" : ` Device: ${md(finding.deviceId)}.`
    return `- ${title} \`${finding.code}\`: ${md(finding.message)}${setting}${device}`
  })
}

function section(title, lines) {
  return lines.length === 0 ? [] : ["", `## ${title}`, "", ...lines]
}

function attemptLine(attempt) {
  const status = ATTEMPT_STATUS_TEXT[attempt.status]
  if (attempt.status !== "failed") {
    return `  - Attempt ${attempt.attempt} ${status}.`
  }
  const failure = attempt.class === null ? "" : `: \`${attempt.class}\``
  const step =
    attempt.failedStep === null ? "" : ` at "${md(attempt.failedStep)}"`
  const parts = [`  - Attempt ${attempt.attempt} ${status}${failure}${step}.`]
  if (attempt.knownBugTicket !== null) {
    parts.push(`Known-Bug ticket: ${md(attempt.knownBugTicket)}.`)
  }
  if (attempt.restart) parts.push("The runner restarted the device.")
  if (attempt.notRunSteps.length > 0) {
    parts.push(`Steps that did not run: ${md(listText(attempt.notRunSteps))}.`)
  }
  if (attempt.screenshot !== null) {
    parts.push(`[Screenshot](${relativeHref(attempt.screenshot)})`)
  }
  return parts.join(" ")
}

function failureLines(summary) {
  return summary.journeys
    .filter((entry) => entry.label !== "pass")
    .flatMap((entry) => [
      `- **${LABEL_NAMES[entry.label]}**: ${md(entry.journey)} on ${md(entry.deviceId)}`,
      ...entry.attempts.map(attemptLine),
    ])
}

function screenLines(screens) {
  if (screens === null) return ["- The screen list check did not run."]
  return [
    `- Screen list gaps: ${screens.gaps.length}`,
    ...screens.gaps.map(
      (gap) => `  - ${md(gap.screen)} has no journey on ${md(gap.platform)}.`,
    ),
    ...screens.notReached.map(
      (entry) =>
        `- Not reached: ${md(entry.screen)} on ${md(entry.deviceId)}, because a journey failed first.`,
    ),
  ]
}

function statMedian(stat) {
  return stat === null ? "None" : formatMs(stat.median)
}

function speedLines(speed) {
  if (speed === null) return ["The speed pass did not run."]
  return [
    "Information only. These numbers do not decide pass or fail.",
    "",
    "| Device | Cold launch (median) | Home content (median) | First video frame (median) | Peak memory |",
    "| --- | --- | --- | --- | --- |",
    ...speed.devices.map(
      (device) =>
        `| ${md(device.deviceId)} | ${statMedian(device.coldLaunchMs)} | ${statMedian(device.homeContentMs)} | ${statMedian(device.firstFrameMs)} | ${device.peakMemoryMb === null ? "None" : `${device.peakMemoryMb} MB`} |`,
    ),
  ]
}

/** summary.md, from a checked summary.json only. */
function renderMarkdown(summary) {
  const headline = headlineOf(summary)
  const { checks, server } = summary
  const lines = [
    `# ${md(headline.title)}`,
    "",
    ...headline.lines.map(md),
    "",
    `- Commit: \`${summary.commit}\``,
    `- Scope: ${summary.scope}`,
    `- Result: ${summary.result}`,
    `- Stop reason: \`${summary.stopReason}\`. ${STOP_REASON_TEXT[summary.stopReason]}`,
    `- Completed phases: ${md(listText(summary.completedPhases))}`,
    `- Started: ${md(summary.startedAt)}`,
    `- Ended: ${md(summary.endedAt)}`,
    `- Duration: ${durationText(summary)}`,
    `- Run ID: ${md(summary.runId)}`,
    "",
    "## Journeys on devices for each label",
    "",
    "| Label | Count |",
    "| --- | --- |",
    ...LABEL_ORDER.map(
      (label) => `| ${LABEL_TITLES[label]} | ${summary.counts[label]} |`,
    ),
    "",
    "## Checks",
    "",
    checkLine("Build check", checks.build),
    checkLine("Log check", checks.log),
    checkLine("Settings probe", checks.settingsProbe),
    ...screenLines(checks.screens),
    ...findingLines("Build check", checks.build),
    ...findingLines("Log check", checks.log),
    ...findingLines("Settings probe", checks.settingsProbe),
    ...section(
      "Admin rate-limit refusals",
      server.rateLimitRefusals.map(
        (refusal) =>
          `- ${md(refusal.ts)}: field ${md(refusal.field)} on ${md(refusal.deviceId)}, journey ${md(refusal.journey)}, attempt ${md(refusal.attempt)}. Failure it caused: ${md(causedFailureText(refusal.causedFailure))}.`,
      ),
    ),
    ...section("Failures", failureLines(summary)),
    ...section(
      "Device restarts",
      summary.restarts.map(
        (restart) =>
          `- ${md(restart.deviceId)} at ${md(restart.ts)}: ${md(restart.reason)}`,
      ),
    ),
    ...section(
      "Known-Bug entries to remove",
      summary.staleKnownBugs.map(
        (entry) =>
          `- ${md(entry.journey)}, step "${md(entry.step)}", ticket ${md(entry.ticket)}. The journey now passes, so remove this entry.`,
      ),
    ),
    ...section(
      "Not-Tested List",
      summary.notTested.map(
        (entry) =>
          `- ${md(entry.kind)} ${md(entry.target)} (${md(listText(entry.platforms))}): ${md(entry.reason)}`,
      ),
    ),
    ...section(
      "Proposed list changes",
      summary.proposedActions.length === 0
        ? []
        : [
            "The runner does not apply these. The mobile owner approves each change through a commit.",
            "",
            ...summary.proposedActions.map(
              (action) =>
                `- ${md(actionText(action))} Reason: ${md(action.reason)}`,
            ),
          ],
    ),
    "",
    "## Speed (information only)",
    "",
    ...speedLines(summary.speed),
    "",
    `The page ${REPORT_FILE} in this folder lists every journey on every device.`,
  ]
  return `${lines.join("\n")}\n`
}

module.exports = { renderMarkdown }
