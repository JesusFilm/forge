import { describe, expect, it, vi } from "vitest"

import {
  ConsumerAccessError,
  type ConsumerAccess,
} from "../../contracts/consumer-access.js"
import { createConsumerRoutes } from "./portal-consumers.js"

function fixture() {
  const create = vi.fn(
    async (input: Parameters<ConsumerAccess["create"]>[0]) => {
      if (
        input.verifyCurrentAdmission &&
        !(await input.verifyCurrentAdmission())
      )
        throw new ConsumerAccessError("forbidden")
      return {
        consumer: {
          consumerId: "00000000-0000-4000-8000-000000000001",
          name: input.name,
          state: "active" as const,
          allowedSourceKeys: input.allowedSourceKeys,
          createdAt: new Date("2026-09-26T00:00:00Z"),
        },
        secret: "synthetic-one-time-secret",
      }
    },
  )
  const addMember = vi.fn(
    async (input: Parameters<ConsumerAccess["addMember"]>[0]) => {
      if (!(await input.verifyCurrentEligibility()))
        throw new ConsumerAccessError("forbidden")
    },
  )
  const consumers = {
    recordAllowlistRevision: async () => {},
    create,
    addMember,
    list: async () => [],
    listForUsage: async () => [],
    members: async () => [],
    removeMember: async () => {},
    rotate: async () => ({
      secret: "synthetic-replacement",
      credentialVersion: 2,
    }),
    transition: async () => {},
    recover: async () => ({
      secret: "synthetic-recovered",
      credentialVersion: 3,
    }),
    delete: async () => {},
  } satisfies ConsumerAccess
  const current = vi.fn(async () => ({
    sha: "merged",
    allowlist: {
      users: [
        { id: 42, login: "owner" },
        { id: 43, login: "member" },
      ],
    },
  }))
  const app = createConsumerRoutes({
    consumers,
    admission: {
      current,
      eligible: async (identity) => identity.id === 42 || identity.id === 43,
      exchange: async () => ({ id: 42, login: "owner" }),
    },
    authorize: async (token) =>
      token === "session" ? { id: 42, login: "owner" } : null,
    origin: "https://rag.example",
    allowedSourceKeys: ["approved-source"],
  })
  const headers = {
    Cookie: "__Host-rag_portal=session",
    Origin: "https://rag.example",
    "Content-Type": "application/json",
  }
  return { app, create, addMember, headers, current }
}

describe("authenticated consumer routes", () => {
  it("derives the initial owner and source scope from the server", async () => {
    const f = fixture()
    const response = await f.app.request("/", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ name: "ragbot" }),
    })
    expect(response.status).toBe(201)
    expect(f.create).toHaveBeenCalledWith({
      name: "ragbot",
      actorGithubUserId: "42",
      allowedSourceKeys: ["approved-source"],
      admissionSha: "merged",
      verifyCurrentAdmission: expect.any(Function),
    })
    expect(await response.json()).toMatchObject({
      initialOwner: { id: 42, login: "owner" },
      secret: "synthetic-one-time-secret",
    })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(
      (
        await f.app.request("/", {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify({ name: "ragbot", ownerGithubUserId: "43" }),
        })
      ).status,
    ).toBe(400)
  })

  it("denies issuance if admission is removed after middleware authorization", async () => {
    const f = fixture()
    f.current.mockResolvedValueOnce({
      sha: "merged",
      allowlist: { users: [{ id: 42, login: "owner" }] },
    })
    f.current.mockResolvedValue({ sha: "removed", allowlist: { users: [] } })
    const response = await f.app.request("/", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ name: "race" }),
    })
    expect(response.status).toBe(403)
    expect(f.current).toHaveBeenCalledTimes(2)
  })

  it("requires the current allowlist and same origin for membership changes", async () => {
    const f = fixture()
    const path = "/00000000-0000-4000-8000-000000000001/members"
    const unlisted = await f.app.request(path, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ githubUserId: 44, expectedVersion: 1 }),
    })
    expect(unlisted.status).toBe(403)
    expect(f.addMember).toHaveBeenCalledTimes(1)
    const crossSite = await f.app.request(path, {
      method: "POST",
      headers: { ...f.headers, Origin: "https://other.example" },
      body: JSON.stringify({ githubUserId: 43, expectedVersion: 1 }),
    })
    expect(crossSite.status).toBe(403)
    const accepted = await f.app.request(path, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ githubUserId: 43, expectedVersion: 1 }),
    })
    expect(accepted.status).toBe(201)
    expect(f.addMember).toHaveBeenCalledWith({
      consumerId: "00000000-0000-4000-8000-000000000001",
      actorGithubUserId: "42",
      memberGithubUserId: "43",
      expectedVersion: 1,
      admissionSha: "merged",
      verifyCurrentEligibility: expect.any(Function),
    })
  })
})

it("accepts an unrelated merge and supplies the fresh admission revision", async () => {
  const f = fixture()
  f.current.mockResolvedValueOnce({
    sha: "old-revision",
    allowlist: { users: [{ id: 42, login: "owner" }] },
  })
  f.current.mockResolvedValue({
    sha: "fresh-revision",
    allowlist: { users: [{ id: 42, login: "owner" }] },
  })
  const response = await f.app.request("/", {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify({ name: "unrelated-merge" }),
  })
  expect(response.status).toBe(201)
  const input = f.create.mock.calls[0][0]
  expect(await input.verifyCurrentAdmission?.()).toBe("fresh-revision")
})
