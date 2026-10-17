import { describe, expect, it } from "vitest"
import { validatePortalUsers } from "./validate-portal-users.js"

const source = JSON.stringify({ users: [{ login: "Engineer", id: 42 }] })
const response = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response
const fetcher = (...responses: Response[]) => {
  let index = 0
  return (async () => responses[index++]) as typeof fetch
}

describe("portal allowlist CI", () => {
  it("reports normalized entries, sha, predicates and verified pass", async () => {
    const result = await validatePortalUsers(
      source,
      "candidate",
      "token",
      fetcher(
        response(200, { id: 42, login: "Engineer" }),
        response(200, { permission: "write" }),
      ),
    )
    expect(result).toMatchObject({
      sha: "candidate",
      status: "pass",
      normalizedEntries: [{ login: "engineer", id: 42 }],
    })
    expect(result.predicates).toContain(
      "Forge repository permission is write, maintain or admin",
    )
  })
  it("distinguishes malformed, duplicate and known ineligible", async () => {
    expect((await validatePortalUsers("{", "sha", "token")).status).toBe("fail")
    expect(
      (
        await validatePortalUsers(
          JSON.stringify({
            users: [
              { login: "a", id: 1 },
              { login: "A", id: 2 },
            ],
          }),
          "sha",
          "token",
        )
      ).status,
    ).toBe("fail")
    expect(
      (
        await validatePortalUsers(
          source,
          "sha",
          "token",
          fetcher(
            response(200, { id: 42, login: "Engineer" }),
            response(200, { permission: "read" }),
          ),
        )
      ).status,
    ).toBe("fail")
  })
  it("marks private visibility and unavailable lookup unverified", async () => {
    expect(
      (
        await validatePortalUsers(
          source,
          "sha",
          "token",
          fetcher(
            response(200, { id: 42, login: "Engineer" }),
            response(404, {}),
          ),
        )
      ).status,
    ).toBe("unverified")
    expect((await validatePortalUsers(source, "sha", undefined)).status).toBe(
      "unverified",
    )
  })
})
