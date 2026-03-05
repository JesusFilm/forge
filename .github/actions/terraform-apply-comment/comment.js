async function main({ github, context, core, fs, path }) {
  const stack = core.getInput("stack", { required: true })
  const exitCode = Number(core.getInput("exit_code", { required: true }) || "1")
  const env = core.getInput("env", { required: true })
  const outputPath = path.join(
    process.env.GITHUB_WORKSPACE || ".",
    core.getInput("output_file", { required: true }),
  )

  const status = exitCode === 0 ? "Applied" : "Apply failed"
  const icon = exitCode === 0 ? "✅" : "❌"
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`

  let applyOutput = ""
  try {
    applyOutput = fs.readFileSync(outputPath, "utf8")
  } catch (e) {
    applyOutput = `Unable to read apply output: ${e.message}`
  }

  const summaryMatch = applyOutput.match(
    /Apply complete!\s+Resources:\s+(\d+)\s+added,\s+(\d+)\s+changed,\s+(\d+)\s+destroyed\./,
  )
  const changeSummary = summaryMatch
    ? `+${summaryMatch[1]} ~${summaryMatch[2]} -${summaryMatch[3]}`
    : "n/a"

  const now = new Date()
  const fmt = (tz, label) =>
    `${label}: ${now.toLocaleString("en-CA", { timeZone: tz, dateStyle: "short", timeStyle: "medium" })}`
  const timestamps = [
    fmt("UTC", "UTC"),
    fmt("Pacific/Auckland", "NZ"),
    fmt("America/Los_Angeles", "PT"),
    fmt("America/New_York", "ET"),
  ].join(" | ")

  const maxLen = 45000
  if (applyOutput.length > maxLen) {
    applyOutput = `${applyOutput.slice(0, maxLen)}\n\n... (truncated)`
  }

  const body = [
    `<!-- terraform-apply-${stack}:${env} -->`,
    `## ${icon} Terraform apply (${stack}/${env}) — ${status}`,
    `**Changes:** ${changeSummary}`,
    `**Time:** ${timestamps}`,
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
