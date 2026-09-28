import { Hono } from "hono"
import { getCookie } from "hono/cookie"

import {
  ConsumerAccessError,
  type ConsumerAccess,
} from "../../contracts/consumer-access.js"
import type {
  AdmissionProvider,
  AdmissionPublication,
  GitHubIdentity,
} from "./portal-github.js"
import { admitted } from "./portal-policy.js"

const SESSION_COOKIE = "__Host-rag_portal"

type Deps = {
  consumers: ConsumerAccess
  admission: AdmissionProvider
  authorize(token: string | undefined): Promise<GitHubIdentity | null>
  origin: string
  allowedSourceKeys: string[]
}

const status = (error: unknown): number => {
  if (!(error instanceof ConsumerAccessError)) return 503
  return { invalid: 400, forbidden: 403, missing: 404, conflict: 409 }[
    error.code
  ]
}

function parseVersionRequest(
  value: unknown,
  allowReason: boolean,
): { expectedVersion: number; reason?: "routine" | "lost" } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const keys = Object.keys(body).sort().join(",")
  if (
    keys !== "expectedVersion" &&
    !(allowReason && keys === "expectedVersion,reason")
  )
    return null
  if (
    !Number.isSafeInteger(body.expectedVersion) ||
    (body.expectedVersion as number) < 1
  )
    return null
  if (
    body.reason !== undefined &&
    body.reason !== "routine" &&
    body.reason !== "lost"
  )
    return null
  return {
    expectedVersion: body.expectedVersion as number,
    reason: body.reason as "routine" | "lost" | undefined,
  }
}

export function createConsumerRoutes(deps: Deps) {
  const app = new Hono<{
    Variables: {
      identity: GitHubIdentity
      publication: AdmissionPublication
    }
  }>()
  const origin = new URL(deps.origin).origin
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof ConsumerAccessError ? error.code : "unavailable",
      },
      status(error) as 400,
    ),
  )
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store")
    const identity = await deps.authorize(getCookie(c, SESSION_COOKIE))
    if (!identity) return c.json({ error: "unauthorized" }, 401)
    const publication = await deps.admission.current()
    if (!admitted(publication.allowlist, identity.login, identity.id))
      return c.json({ error: "unauthorized" }, 401)
    await deps.consumers.recordAllowlistRevision(publication.sha)
    c.set("identity", identity)
    c.set("publication", publication)
    if (c.req.method !== "GET") {
      if (
        c.req.header("origin") !== origin ||
        c.req.header("sec-fetch-site") === "cross-site"
      )
        return c.json({ error: "origin_invalid" }, 403)
    }
    await next()
  })

  const identity = (c: {
    get(key: "identity"): GitHubIdentity
  }): GitHubIdentity => c.get("identity")
  const verifyCurrentAdmission =
    (actor: GitHubIdentity) =>
    async (signal?: AbortSignal): Promise<string | null> => {
      const fresh = await deps.admission.current(signal)
      return admitted(fresh.allowlist, actor.login, actor.id) &&
        (await deps.admission.eligible(actor, signal))
        ? fresh.sha
        : null
    }

  app.get("/", async (c) => {
    const rows = await deps.consumers.list(String(identity(c).id))
    return c.json({
      consumers: rows.map((row) => ({
        consumerId: row.consumerId,
        name: row.name,
        state: row.state,
        owned: row.owned,
        credentialVersion: row.owned ? row.credentialVersion : undefined,
        membershipVersion: row.owned ? row.membershipVersion : undefined,
      })),
    })
  })
  app.post("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).join(",") !== "name" ||
      typeof (body as { name?: unknown }).name !== "string"
    )
      return c.json({ error: "invalid" }, 400)
    const created = await deps.consumers.create({
      name: (body as { name: string }).name,
      actorGithubUserId: String(identity(c).id),
      allowedSourceKeys: deps.allowedSourceKeys,
      admissionSha: c.get("publication").sha,
      verifyCurrentAdmission: verifyCurrentAdmission(identity(c)),
    })
    return c.json(
      {
        consumerId: created.consumer.consumerId,
        name: created.consumer.name,
        initialOwner: identity(c),
        secret: created.secret,
        credentialVersion: 1,
      },
      201,
      { "Cache-Control": "no-store" },
    )
  })
  app.get("/:id/members", async (c) =>
    c.json({
      members: await deps.consumers.members(
        c.req.param("id"),
        String(identity(c).id),
      ),
    }),
  )
  app.post("/:id/members", async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "expectedVersion,githubUserId" ||
      !Number.isSafeInteger(
        (body as { githubUserId?: unknown }).githubUserId,
      ) ||
      !Number.isSafeInteger(
        (body as { expectedVersion?: unknown }).expectedVersion,
      )
    )
      return c.json({ error: "invalid" }, 400)
    const target = (body as { githubUserId: number }).githubUserId
    const publication = c.get("publication")
    await deps.consumers.addMember({
      consumerId: c.req.param("id"),
      actorGithubUserId: String(identity(c).id),
      memberGithubUserId: String(target),
      expectedVersion: (body as { expectedVersion: number }).expectedVersion,
      admissionSha: publication.sha,
      verifyCurrentEligibility: async (signal) => {
        const fresh = await deps.admission.current(signal)
        const actor = identity(c)
        const candidate = fresh.allowlist.users.find(
          (entry) => entry.id === target,
        )
        if (
          !admitted(fresh.allowlist, actor.login, actor.id) ||
          !(await deps.admission.eligible(actor, signal)) ||
          !candidate ||
          !admitted(fresh.allowlist, candidate.login, target) ||
          !(await deps.admission.eligible(candidate, signal))
        )
          return null
        return fresh.sha
      },
    })
    return c.json({ added: true }, 201)
  })
  app.delete("/:id/members/:memberId", async (c) => {
    const body = parseVersionRequest(
      await c.req.json().catch(() => null),
      false,
    )
    if (!body) return c.json({ error: "invalid" }, 400)
    await deps.consumers.removeMember({
      consumerId: c.req.param("id"),
      actorGithubUserId: String(identity(c).id),
      memberGithubUserId: c.req.param("memberId"),
      expectedVersion: body.expectedVersion,
      admissionSha: c.get("publication").sha,
      verifyCurrentAdmission: verifyCurrentAdmission(identity(c)),
    })
    return c.json({ removed: true })
  })
  app.post("/:id/rotate", async (c) => {
    const body = parseVersionRequest(await c.req.json().catch(() => null), true)
    if (!body) return c.json({ error: "invalid" }, 400)
    const result = await deps.consumers.rotate({
      consumerId: c.req.param("id"),
      actorGithubUserId: String(identity(c).id),
      expectedVersion: body.expectedVersion,
      admissionSha: c.get("publication").sha,
      reason: body.reason,
      verifyCurrentAdmission: verifyCurrentAdmission(identity(c)),
    })
    return c.json(result, 200, { "Cache-Control": "no-store" })
  })
  app.post("/:id/state", async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).join(",") !== "state"
    )
      return c.json({ error: "invalid" }, 400)
    const state = (body as { state?: unknown }).state
    if (state !== "active" && state !== "suspended" && state !== "revoked")
      return c.json({ error: "invalid" }, 400)
    await deps.consumers.transition({
      consumerId: c.req.param("id"),
      actorGithubUserId: String(identity(c).id),
      state,
      admissionSha: c.get("publication").sha,
      verifyCurrentAdmission: verifyCurrentAdmission(identity(c)),
    })
    return c.json({ state })
  })
  return app
}
