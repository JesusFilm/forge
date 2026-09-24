import { afterEach, expect, it, vi } from "vitest"

import { createGitHubAdmission } from "./portal-github.js"

afterEach(() => vi.unstubAllGlobals())

it("rejects stale or incomplete merged-branch publication", async () => {
  const provider = createGitHubAdmission({
    repositoryToken: "synthetic",
    clientId: "client",
    clientSecret: "synthetic",
    callbackUrl: "https://rag.example/portal/callback",
  })
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ commit: { sha: "a".repeat(40) } }), {
        status: 200,
        headers: { Date: new Date(Date.now() - 120_000).toUTCString() },
      }),
    ),
  )
  await expect(provider.current()).rejects.toThrow("github_stale")
})

it("discards the provider token after resolving the stable GitHub identity", async () => {
  const provider = createGitHubAdmission({
    repositoryToken: "synthetic",
    clientId: "client",
    clientSecret: "synthetic",
    callbackUrl: "https://rag.example/portal/callback",
  })
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-access-token",
            token_type: "bearer",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42, login: "engineer" }), {
          headers: { Date: new Date().toUTCString() },
        }),
      ),
  )
  const identity = await provider.exchange("synthetic-code")
  expect(identity).toEqual({ id: 42, login: "engineer" })
  expect(JSON.stringify(identity)).not.toContain("synthetic-access-token")
})
