async function main({ github, context, core, fs, path }) {
  const stack = core.getInput("stack", { required: true })
  const exitCode = Number(core.getInput("exit_code", { required: true }) || "1")
  const env = core.getInput("env", { required: true })
  const outputPath = path.join(
    process.env.GITHUB_WORKSPACE || ".",
    core.getInput("output_file", { required: true }),
  )
  const fallbackPathRaw = (core.getInput("fallback_log") || "").trim()
  const fallbackPath = fallbackPathRaw
    ? path.join(process.env.GITHUB_WORKSPACE || ".", fallbackPathRaw)
    : ""

  let applyOutput = ""
  let usedFallback = false
  try {
    applyOutput = fs.readFileSync(outputPath, "utf8")
  } catch (e) {
    if (fallbackPath) {
      try {
        applyOutput = fs.readFileSync(fallbackPath, "utf8")
        usedFallback = true
      } catch (e2) {
        applyOutput = `Unable to read apply output: ${e.message}. Fallback: ${e2.message}`
      }
    } else {
      applyOutput = `Unable to read apply output: ${e.message}`
    }
  }
  if (!usedFallback && applyOutput.trim() === "" && fallbackPath) {
    try {
      applyOutput = fs.readFileSync(fallbackPath, "utf8")
      usedFallback = true
    } catch (e2) {
      applyOutput = "Apply output empty and no fallback log available."
    }
  } else if (applyOutput.trim() === "") {
    applyOutput = "Apply output empty."
  }

  const status = usedFallback
    ? "Pre-apply step failed (init)"
    : exitCode === 0
      ? "Applied"
      : "Apply failed"
  const icon = usedFallback || exitCode !== 0 ? "❌" : "✅"
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`

  const summaryMatch = applyOutput.match(
    /Apply complete!\s+Resources:\s+(\d+)\s+added,\s+(\d+)\s+changed,\s+(\d+)\s+destroyed\./,
  )
  const changeSummary = summaryMatch
    ? `+${summaryMatch[1]} ~${summaryMatch[2]} -${summaryMatch[3]}`
    : "n/a"

  const now = new Date()
  const fmt = (tz, label) => [
    label,
    now.toLocaleString("en-CA", {
      timeZone: tz,
      dateStyle: "short",
      timeStyle: "medium",
    }),
  ]
  const timeRows = [
    fmt("UTC", "UTC"),
    fmt("Pacific/Auckland", "NZ"),
    fmt("America/Los_Angeles", "PT"),
    fmt("America/New_York", "ET"),
  ].map(([label, time]) => `| ${label} | ${time} |`)
  const timeTable = ["| TZ | Time |", "| --- | --- |", ...timeRows].join("\n")

  const maxLen = 45000
  if (applyOutput.length > maxLen) {
    applyOutput = `${applyOutput.slice(0, maxLen)}\n\n... (truncated)`
  }

  const body = [
    `<!-- terraform-apply-${stack}:${env} -->`,
    `## ${icon} Terraform apply (${stack}/${env}) — ${status}`,
    `**Changes:** ${changeSummary}`,
    "**Time:**",
    timeTable,
    "",
    `Run: ${runUrl}`,
    "",
    "```",
    applyOutput,
    "```",
  ].join("\n")

  await github.rest.repos.createCommitComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    commit_sha: context.sha,
    body,
  })
}

module.exports = main
