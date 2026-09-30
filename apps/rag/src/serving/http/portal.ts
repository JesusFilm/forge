import { Hono } from "hono"
import type { PortalSources } from "./portal-sources.js"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"

import { admitted } from "./portal-policy.js"
import type {
  PortalSessionExpiry,
  SessionStore,
} from "../../contracts/portal-sessions.js"
import { randomToken } from "./portal-token.js"
import {
  OAuthInvalidError,
  type AdmissionProvider,
  type GitHubIdentity,
} from "./portal-github.js"
import type { ConsumerAccess } from "../../contracts/consumer-access.js"
import type { UsageReader } from "../../contracts/consumer-usage.js"
import { usageReportResponse, usageReportsResponse } from "./usage-report.js"
import { createConsumerRoutes } from "./portal-consumers.js"
import {
  portalFonts,
  portalLogo,
  portalConstructionImage,
  portalHtml,
  portalCss,
  portalScript,
  portalUsageScript,
  portalSourcesScript,
  portalSourcesCss,
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
const cookieAge = (expiry: PortalSessionExpiry) =>
  Math.max(1, Math.ceil((Date.parse(expiry.expiresAt) - Date.now()) / 1000))

export type PortalDeps = {
  admission: AdmissionProvider
  sessions: SessionStore
  clientId: string
  callbackUrl: string
  origin: string
  usageReader?: UsageReader
  consumers?: ConsumerAccess
  allowedSourceKeys?: string[]
  sources?: () => Promise<PortalSources>
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
    knownSession?: GitHubIdentity | null,
  ): Promise<GitHubIdentity | null> => {
    if (!token) return null
    const identity =
      knownSession === undefined
        ? await deps.sessions.getSession(token)
        : knownSession
    if (!identity) return null
    const publication = await deps.admission.current()
    if (!admitted(publication.allowlist, identity.login, identity.id))
      return null
    if (!(await deps.admission.eligible(identity))) return null
    return identity
  }

  app.get("/login", async (c) => {
    const state = randomToken()
    const browser = getCookie(c, STATE_COOKIE) ?? randomToken()
    try {
      await deps.sessions.createState(state, browser)
    } catch {
      return c.redirect("/portal?recovery=unavailable", 303)
    }
    setCookie(c, STATE_COOKIE, browser, { ...cookie, maxAge: 7 * 24 * 3600 })
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
    if (!state || !code || !browser)
      return c.redirect("/portal?recovery=oauth_invalid", 303)
    try {
      if (!(await deps.sessions.consumeState(state, browser)))
        return c.redirect("/portal?recovery=oauth_invalid", 303)
    } catch {
      return c.redirect("/portal?recovery=unavailable", 303)
    }
    let identity: GitHubIdentity
    try {
      identity = await deps.admission.exchange(code)
    } catch (error) {
      return c.redirect(
        error instanceof OAuthInvalidError
          ? "/portal?recovery=oauth_invalid"
          : "/portal?recovery=unavailable",
        303,
      )
    }
    try {
      const publication = await deps.admission.current()
      if (
        !admitted(publication.allowlist, identity.login, identity.id) ||
        !(await deps.admission.eligible(identity))
      )
        return c.redirect("/portal?recovery=admission_denied", 303)
    } catch {
      return c.redirect("/portal?recovery=unavailable", 303)
    }
    try {
      const previous = getCookie(c, SESSION_COOKIE)
      if (previous) await deps.sessions.revokeSession(previous)
      const token = randomToken()
      const expiry = await deps.sessions.createSession(token, identity)
      setCookie(c, SESSION_COOKIE, token, {
        ...cookie,
        maxAge: cookieAge(expiry),
      })
    } catch {
      return c.redirect("/portal?recovery=unavailable", 303)
    }
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

  app.get("/assets/usage.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8")
    return c.body(portalUsageScript)
  })

  app.get("/assets/sources.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8")
    return c.body(portalSourcesScript)
  })
  app.get("/assets/sources.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8")
    return c.body(portalSourcesCss)
  })
  app.get("/sources", async (c) => {
    const identity = await authorize(getCookie(c, SESSION_COOKIE))
    if (!identity) return c.json({ error: "unauthorized" }, 401)
    try {
      if (deps.sources) return c.json(await deps.sources())
    } catch {
      /* Failure is isolated to this view; no data or internal errors are logged. */
    }
    return c.json({ error: "sources_snapshot_unavailable" }, 503)
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
    const token = getCookie(c, SESSION_COOKIE)
    const session = token ? await deps.sessions.getSession(token) : null
    if (!token || !session)
      return c.json({ error: "session_expired" }, 401, {
        "Cache-Control": "no-store",
      })
    const identity = await authorize(token, session)
    if (!identity)
      return c.json({ error: "admission_denied" }, 403, {
        "Cache-Control": "no-store",
      })
    const expiry = await deps.sessions.getExpiry(token)
    if (!expiry) return c.json({ error: "session_expired" }, 401)
    return c.json(
      {
        login: identity.login,
        githubId: identity.id,
        managementAvailable: !!deps.consumers,
        usageAvailable: !!deps.usageReader && !!deps.consumers,
        ...expiry,
      },
      200,
      {
        "Cache-Control": "no-store",
      },
    )
  })

  app.post("/session/renew", async (c) => {
    if (
      c.req.header("origin") !== origin.origin ||
      c.req.header("sec-fetch-site") === "cross-site"
    )
      return c.json({ error: "origin_invalid" }, 403)
    const token = getCookie(c, SESSION_COOKIE)
    const session = token ? await deps.sessions.getSession(token) : null
    if (!token || !session) return c.json({ error: "session_expired" }, 401)
    if (!(await authorize(token, session)))
      return c.json({ error: "admission_denied" }, 403)
    const expiry = await deps.sessions.renewSession(token)
    if (!expiry) return c.json({ error: "session_expired" }, 401)
    setCookie(c, SESSION_COOKIE, token, {
      ...cookie,
      maxAge: cookieAge(expiry),
    })
    return c.json(expiry)
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
    if (token) await deps.sessions.revokeSession(token)
    deleteCookie(c, SESSION_COOKIE, cookie)
    deleteCookie(c, STATE_COOKIE, cookie)
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

  if (deps.usageReader) {
    const reader = deps.usageReader
    app.get("/usage/reports", async (c) => {
      const identity = await authorize(getCookie(c, SESSION_COOKIE))
      if (!identity) return c.json({ error: "unauthorized" }, 401)
      return usageReportsResponse(c, reader)
    })
    app.get("/usage", async (c) => {
      const identity = await authorize(getCookie(c, SESSION_COOKIE))
      if (!identity) return c.json({ error: "unauthorized" }, 401)
      return usageReportResponse(c, reader)
    })
  }

  return app
}
