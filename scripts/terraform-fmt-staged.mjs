#!/usr/bin/env node
/**
 * Run terraform fmt -recursive in each infra root that has staged .tf files,
 * then re-stage those roots so formatted files are included in the commit.
 * Used by lint-staged for staged files under infra/.
 */
import { execSync } from "child_process"
import { fileURLToPath } from "url"
import path from "path"

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const ROOTS = ["infra/aws", "infra/vercel", "infra/github"]

const staged = process.argv.slice(2).filter((f) => f.endsWith(".tf"))
const rootsToFmt = [
  ...new Set(
    staged
      .map((f) => f.split("/").slice(0, 2).join("/"))
      .filter((r) => ROOTS.includes(r)),
  ),
]

for (const root of rootsToFmt) {
  const dir = path.join(REPO_ROOT, root)
  execSync("terraform fmt -recursive", { cwd: dir, stdio: "inherit" })
  execSync(`git add ${root}`, { cwd: REPO_ROOT, stdio: "inherit" })
}
