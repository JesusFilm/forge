import { parsePortalAllowlist, type PortalAllowlist } from "./portal-policy.js"

export type GitHubIdentity = { id: number; login: string }
export type AdmissionPublication = { sha: string; allowlist: PortalAllowlist }
export type AdmissionProvider = {
  current(): Promise<AdmissionPublication>
  eligible(identity: GitHubIdentity): Promise<boolean>
  exchange(code: string): Promise<GitHubIdentity>
}

const api = "https://api.github.com"
const repository = "JesusFilm/forge"
const headers = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
})

async function json(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { ...headers(token), "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error("github_unverified")
  const responseDate = Date.parse(response.headers.get("date") ?? "")
  const age = Number(response.headers.get("age") ?? "0")
  if (
    !Number.isFinite(responseDate) ||
    !Number.isFinite(age) ||
    age > 60 ||
    Math.abs(Date.now() - responseDate) > 60_000
  )
    throw new Error("github_stale")
  return response.json()
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("github_unverified")
  return value as Record<string, unknown>
}

export function createGitHubAdmission(config: {
  repositoryToken: string
  clientId: string
  clientSecret: string
  callbackUrl: string
}): AdmissionProvider {
  return {
    async current() {
      const branch = object(
        await json(
          `${api}/repos/${repository}/branches/main`,
          config.repositoryToken,
        ),
      )
      const commit = object(branch.commit)
      if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha))
        throw new Error("github_unverified")
      const sha = commit.sha
      const data = object(
        await json(
          `${api}/repos/${repository}/contents/apps/rag/portal/users.json?ref=${sha}`,
          config.repositoryToken,
        ),
      )
      if (data.encoding !== "base64" || typeof data.content !== "string")
        throw new Error("github_unverified")
      const allowlist = parsePortalAllowlist(
        JSON.parse(Buffer.from(data.content, "base64").toString("utf8")),
      )
      return { sha, allowlist }
    },
    async eligible(identity) {
      const user = object(
        await json(
          `${api}/users/${encodeURIComponent(identity.login)}`,
          config.repositoryToken,
        ),
      )
      if (
        user.id !== identity.id ||
        typeof user.login !== "string" ||
        user.login.toLowerCase() !== identity.login.toLowerCase()
      )
        return false
      const result = object(
        await json(
          `${api}/repos/${repository}/collaborators/${encodeURIComponent(identity.login)}/permission`,
          config.repositoryToken,
        ),
      )
      return (
        result.permission === "admin" ||
        result.permission === "maintain" ||
        result.permission === "write"
      )
    },
    async exchange(code) {
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: config.callbackUrl,
          }),
          signal: AbortSignal.timeout(5000),
        },
      )
      if (!response.ok) throw new Error("oauth_exchange_failed")
      const tokenResult = object(await response.json())
      if (
        typeof tokenResult.access_token !== "string" ||
        tokenResult.token_type !== "bearer"
      )
        throw new Error("oauth_exchange_failed")
      const user = object(await json(`${api}/user`, tokenResult.access_token))
      if (
        !Number.isSafeInteger(user.id) ||
        (user.id as number) <= 0 ||
        typeof user.login !== "string"
      )
        throw new Error("oauth_identity_invalid")
      return { id: user.id as number, login: user.login }
    },
  }
}
