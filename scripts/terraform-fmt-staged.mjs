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

const TERRAFORM_INSTALL_HINT = [
  "Terraform is required to format staged .tf files. Install it and retry:",
  "  macOS (Homebrew):  brew install terraform",
  "  Or download:      https://developer.hashicorp.com/terraform/install",
].join("\n")

for (const root of rootsToFmt) {
  const dir = path.join(REPO_ROOT, root)
  try {
    execSync("terraform fmt -recursive", { cwd: dir, stdio: "inherit" })
    execSync(`git add ${root}`, { cwd: REPO_ROOT, stdio: "inherit" })
  } catch (err) {
    console.error("\nterraform-fmt-staged failed:", err.message)
    console.error(TERRAFORM_INSTALL_HINT)
    throw err
  }
}
