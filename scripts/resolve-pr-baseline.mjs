import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

class PrBaselineError extends Error {
  constructor(message) {
    super(message)
    this.name = "PrBaselineError"
  }
}

export function resolvePrBaseline({ cwd = process.cwd(), headSha, mergeSha }) {
  if (
    ![headSha, mergeSha].every(
      (sha) => typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha),
    )
  ) {
    throw new PrBaselineError(
      "PR head and merge must be 40-character commit SHAs",
    )
  }
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  const [checkout, target, head, ...extraParents] = git(
    "rev-list",
    "--parents",
    "-n",
    "1",
    "HEAD",
  ).split(" ")
  if (checkout !== mergeSha) {
    throw new PrBaselineError("PR merge checkout does not match GITHUB_SHA")
  }
  if (!target || !head || extraParents.length !== 0) {
    throw new PrBaselineError(
      "PR baseline requires a two-parent merge checkout",
    )
  }
  if (head !== headSha) {
    throw new PrBaselineError(
      "PR merge second parent does not match the expected PR head",
    )
  }
  // PR metadata keeps the opening base SHA even after the target advances.
  // The first parent is the target tree actually used by this merge checkout.
  return { target, commitBase: git("merge-base", target, head), head }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const baseline = resolvePrBaseline({
    headSha: process.env.PR_HEAD_SHA,
    mergeSha: process.env.GITHUB_SHA,
  })
  console.log(
    `target=${baseline.target}\ncommit_base=${baseline.commitBase}\nhead=${baseline.head}`,
  )
}
