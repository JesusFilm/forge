import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

import {
  parsePortalAllowlist,
  type PortalUser,
} from "../src/serving/http/portal-policy.js"

export type Verdict = "pass" | "fail" | "unverified"
export type EntryReceipt = {
  login: string
  id: number
  account: Verdict
  identity: Verdict
  forgePermission: Verdict
  reason: string
}

export async function verifyUser(
  user: PortalUser,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<EntryReceipt> {
  const receipt: EntryReceipt = {
    ...user,
    account: "unverified",
    identity: "unverified",
    forgePermission: "unverified",
    reason: "lookup_unavailable",
  }
  if (!token) return { ...receipt, reason: "review_token_missing" }
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }
  try {
    const account = await fetcher(
      `https://api.github.com/users/${encodeURIComponent(user.login)}`,
      { headers, signal: AbortSignal.timeout(5000) },
    )
    if (account.status === 404)
      return { ...receipt, account: "fail", reason: "account_not_found" }
    if (!account.ok)
      return { ...receipt, reason: `account_http_${account.status}` }
    const identity = (await account.json()) as { id?: unknown; login?: unknown }
    if (
      !Number.isSafeInteger(identity.id) ||
      typeof identity.login !== "string"
    )
      return { ...receipt, reason: "account_response_incomplete" }
    if (identity.id !== user.id || identity.login.toLowerCase() !== user.login)
      return {
        ...receipt,
        account: "pass",
        identity: "fail",
        reason: "identity_mismatch",
      }
    receipt.account = "pass"
    receipt.identity = "pass"
    const permission = await fetcher(
      `https://api.github.com/repos/JesusFilm/forge/collaborators/${encodeURIComponent(user.login)}/permission`,
      { headers, signal: AbortSignal.timeout(5000) },
    )
    // A private-repo 404 can mean inadequate token visibility; never infer denial.
    if (!permission.ok)
      return { ...receipt, reason: `permission_http_${permission.status}` }
    const value = (await permission.json()) as { permission?: unknown }
    if (["admin", "maintain", "write"].includes(String(value.permission)))
      return { ...receipt, forgePermission: "pass", reason: "eligible" }
    if (["read", "triage", "none"].includes(String(value.permission)))
      return {
        ...receipt,
        forgePermission: "fail",
        reason: "permission_insufficient",
      }
    return { ...receipt, reason: "permission_response_incomplete" }
  } catch {
    return { ...receipt, reason: "lookup_unavailable" }
  }
}

export async function validatePortalUsers(
  text: string,
  sha: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  try {
    const list = parsePortalAllowlist(JSON.parse(text))
    const entries = await Promise.all(
      list.users.map((user) => verifyUser(user, token, fetcher)),
    )
    const status: Verdict = entries.some((entry) =>
      [entry.account, entry.identity, entry.forgePermission].includes("fail"),
    )
      ? "fail"
      : entries.some((entry) =>
            [entry.account, entry.identity, entry.forgePermission].includes(
              "unverified",
            ),
          )
        ? "unverified"
        : "pass"
    return {
      sha,
      normalizedEntries: list.users,
      predicates: [
        "GitHub account exists",
        "live GitHub login resolves to pinned numeric ID",
        "Forge repository permission is write, maintain or admin",
      ],
      status,
      entries,
    }
  } catch (error) {
    return {
      sha,
      normalizedEntries: [],
      predicates: [
        "strict allowlist schema",
        "valid login and positive ID",
        "case-insensitive unique logins and IDs",
      ],
      status: "fail" as const,
      reason: error instanceof Error ? error.message : "malformed",
    }
  }
}

if (process.argv[1]?.endsWith("validate-portal-users.ts")) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim()
  const report = await validatePortalUsers(
    readFileSync("portal/users.json", "utf8"),
    sha,
    process.env.RAG_PORTAL_ELIGIBILITY_TOKEN,
  )
  console.log(JSON.stringify(report, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs")
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### RAG portal allowlist\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
    )
  }
  if (report.status !== "pass") process.exitCode = 1
}
