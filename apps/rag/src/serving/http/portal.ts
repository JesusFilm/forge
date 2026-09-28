import { Hono } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"

import { admitted } from "./portal-policy.js"
import type { SessionStore } from "../../contracts/portal-sessions.js"
import { randomToken } from "./portal-token.js"
import type { AdmissionProvider, GitHubIdentity } from "./portal-github.js"
import type { ConsumerAccess } from "../../contracts/consumer-access.js"
import { createConsumerRoutes } from "./portal-consumers.js"
import {
  portalFonts,
  portalLogo,
  portalConstructionImage,
  portalHtml,
  portalCss,
  portalScript,
  portalCsp,
} from "./portal-ui.js"

const STATE_COOKIE = "__Host-rag_oauth"
const SESSION_COOKIE = "__Host-rag_portal"
const cookie = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
}

export type PortalDeps = {
  admission: AdmissionProvider
  sessions: SessionStore
  clientId: string
  callbackUrl: string
  origin: string
  consumers?: ConsumerAccess
  allowedSourceKeys?: string[]
}

export function createPortal(deps: PortalDeps): Hono {
  const app = new Hono()
  const origin = new URL(deps.origin)
  const callback = new URL(deps.callbackUrl)
  if (
    origin.protocol !== "https:" ||
    callback.origin !== origin.origin ||
    callback.pathname !== "/portal/callback"
  )
    throw new Error("portal_origin_invalid")

  app.onError(
    () =>
      new Response(JSON.stringify({ error: "admission_unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }),
  )
  app.use("*", async (c, next) => {
    await next()
    c.header("Cache-Control", "no-store")
    c.header("Referrer-Policy", "no-referrer")
    c.header("X-Content-Type-Options", "nosniff")
  })

  const authorize = async (
    token: string | undefined,
  ): Promise<GitHubIdentity | null> => {
    if (!token) return null
    const identity = await deps.sessions.getSession(token)
    if (!identity) return null
    const publication = await deps.admission.current()
    if (!admitted(publication.allowlist, identity.login, identity.id))
      return null
    if (!(await deps.admission.eligible(identity))) return null
    return identity
  }

  app.get("/login", async (c) => {
    const state = randomToken()
    const browser = randomToken()
    await deps.sessions.createState(state, browser)
    setCookie(c, STATE_COOKIE, browser, { ...cookie, maxAge: 600 })
    const url = new URL("https://github.com/login/oauth/authorize")
    url.searchParams.set("client_id", deps.clientId)
    url.searchParams.set("redirect_uri", deps.callbackUrl)
    url.searchParams.set("state", state)
    return c.redirect(url.toString(), 302)
  })

  app.get("/callback", async (c) => {
    const state = c.req.query("state")
    const code = c.req.query("code")
    const browser = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, cookie)
    if (
      !state ||
      !code ||
      !browser ||
      !(await deps.sessions.consumeState(state, browser))
    )
      return c.json({ error: "oauth_invalid" }, 401)
    let identity: GitHubIdentity
    try {
      identity = await deps.admission.exchange(code)
    } catch {
      return c.json({ error: "oauth_invalid" }, 401)
    }
    const publication = await deps.admission.current()
    if (
      !admitted(publication.allowlist, identity.login, identity.id) ||
      !(await deps.admission.eligible(identity))
    )
      return c.json({ error: "admission_denied" }, 403)
    const previous = getCookie(c, SESSION_COOKIE)
    if (previous) await deps.sessions.revokeSession(previous)
    const token = randomToken()
    await deps.sessions.createSession(token, identity)
    setCookie(c, SESSION_COOKIE, token, { ...cookie, maxAge: 7200 })
    return c.redirect("/portal", 303)
  })

  app.get("/", (c) => {
    c.header("Content-Security-Policy", portalCsp)
    return c.html(portalHtml)
  })
  app.get("/assets/portal.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8")
    return c.body(portalCss)
  })
  app.get("/assets/portal.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8")
    return c.body(portalScript)
  })

  app.get("/assets/forge.svg", (c) => {
    c.header("Content-Type", "image/svg+xml")
    return c.body(portalLogo)
  })
  app.get("/assets/under-construction.png", (c) => {
    c.header("Content-Type", "image/png")
    return c.body(new Uint8Array(portalConstructionImage))
  })
  for (const [name, font] of Object.entries(portalFonts)) {
    app.get("/assets/" + name, (c) => {
      c.header("Content-Type", "font/woff2")
      return c.body(new Uint8Array(font))
    })
  }

  app.get("/identity", async (c) => {
    const identity = await authorize(getCookie(c, SESSION_COOKIE))
    if (!identity)
      return c.json({ error: "unauthorized" }, 401, {
        "Cache-Control": "no-store",
      })
    return c.json(
      {
        login: identity.login,
        githubId: identity.id,
        managementAvailable: !!deps.consumers,
      },
      200,
      {
        "Cache-Control": "no-store",
      },
    )
  })

  app.get("/members", async (c) => {
    const identity = await authorize(getCookie(c, SESSION_COOKIE))
    if (!identity) return c.json({ error: "unauthorized" }, 401)
    const publication = await deps.admission.current()
    if (!admitted(publication.allowlist, identity.login, identity.id))
      return c.json({ error: "unauthorized" }, 401)
    // This is a selection directory; mutations independently recheck eligibility.
    return c.json({ users: publication.allowlist.users })
  })

  app.post("/sign-out", async (c) => {
    if (
      c.req.header("origin") !== origin.origin ||
      c.req.header("sec-fetch-site") === "cross-site"
    )
      return c.json({ error: "origin_invalid" }, 403)
    const token = getCookie(c, SESSION_COOKIE)
    const identity = await authorize(token)
    if (!identity || !token) return c.json({ error: "unauthorized" }, 401)
    await deps.sessions.revokeSession(token)
    deleteCookie(c, SESSION_COOKIE, cookie)
    return c.json({ signedOut: true }, 200, { "Cache-Control": "no-store" })
  })

  if (deps.consumers) {
    app.route(
      "/consumers",
      createConsumerRoutes({
        consumers: deps.consumers,
        admission: deps.admission,
        authorize,
        origin: deps.origin,
        allowedSourceKeys: deps.allowedSourceKeys ?? [],
      }),
    )
  }

  return app
}
