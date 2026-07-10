// @vitest-environment node
import { SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const REAL_SECRET = "s".repeat(40)
const OTHER_SECRET = "z".repeat(40)
// Must equal the single-sourced placeholder in env.ts / .env.example.
const PLACEHOLDER = "replace-with-a-long-random-secret-min-32-chars"

// env.ts parses process.env at module load; stub env then re-import fresh.
async function loadModule({
  secret,
  nodeEnv,
  prefix,
}: {
  secret?: string
  nodeEnv?: string
  prefix?: string
} = {}) {
  vi.resetModules()
  if (secret !== undefined) vi.stubEnv("CHAT_SESSION_SECRET", secret)
  if (nodeEnv !== undefined) vi.stubEnv("NODE_ENV", nodeEnv)
  if (prefix !== undefined) vi.stubEnv("AUTH_COOKIE_PREFIX", prefix)
  return import("./session-cookie")
}

// Sign a cookie value directly with an arbitrary secret + exp, bypassing the
// module — used for the wrong-secret, tamper, and expiry cases.
async function signWith(
  secret: string,
  payload: Record<string, unknown>,
  expSecondsFromNow = 3600,
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(nowSec + expSecondsFromNow)
    .sign(new TextEncoder().encode(secret))
}

beforeEach(() => {
  vi.unstubAllEnvs()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("createChatSessionCookie / readChatSessionCookie round-trip", () => {
  it("reads back the same identity claims it signed", async () => {
    const { createChatSessionCookie, readChatSessionCookie } = await loadModule(
      {
        secret: REAL_SECRET,
      },
    )
    const value = await createChatSessionCookie({
      sub: "user-123",
      name: "Ada",
      email: "ada@example.com",
      picture: "https://cdn.example.com/a.png",
    })
    expect(await readChatSessionCookie(value)).toEqual({
      sub: "user-123",
      name: "Ada",
      email: "ada@example.com",
      picture: "https://cdn.example.com/a.png",
    })
  })

  it("omits absent optional claims (avatar-less user)", async () => {
    const { createChatSessionCookie, readChatSessionCookie } = await loadModule(
      {
        secret: REAL_SECRET,
      },
    )
    const value = await createChatSessionCookie({ sub: "u1" })
    expect(await readChatSessionCookie(value)).toEqual({ sub: "u1" })
  })

  it("round-trips emailVerified: true (KTD6)", async () => {
    const { createChatSessionCookie, readChatSessionCookie } = await loadModule(
      {
        secret: REAL_SECRET,
      },
    )
    const value = await createChatSessionCookie({
      sub: "user-123",
      email: "ada@example.com",
      emailVerified: true,
    })
    expect(await readChatSessionCookie(value)).toEqual({
      sub: "user-123",
      email: "ada@example.com",
      emailVerified: true,
    })
  })
})

describe("readChatSessionCookie — emailVerified claim (KTD6)", () => {
  it("reads undefined from a legacy cookie minted without the claim (pre-deploy sessions)", async () => {
    // Legacy sessions predate the claim; the gate treats undefined as
    // unverified (fail-closed), so the read must not invent a value.
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    const legacy = await signWith(REAL_SECRET, {
      sub: "u1",
      email: "a@example.com",
    })
    const identity = await readChatSessionCookie(legacy)
    expect(identity).not.toBeNull()
    expect(identity?.emailVerified).toBeUndefined()
  })

  it('drops a non-boolean claim value (the string "true") on read — strict boolean symmetry', async () => {
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    const forged = await signWith(REAL_SECRET, {
      sub: "u1",
      emailVerified: "true",
    })
    expect((await readChatSessionCookie(forged))?.emailVerified).toBeUndefined()
  })
})

describe("readChatSessionCookie — anonymous on any failure (R11)", () => {
  it("returns null for a cookie past its embedded exp (AE3)", async () => {
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    const expired = await signWith(REAL_SECRET, { sub: "u1" }, -100)
    expect(await readChatSessionCookie(expired)).toBeNull()
  })

  it("returns null for a cookie signed with a different secret", async () => {
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    const foreign = await signWith(OTHER_SECRET, { sub: "u1" })
    expect(await readChatSessionCookie(foreign)).toBeNull()
  })

  it("returns null for a tampered / malformed cookie value", async () => {
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    expect(await readChatSessionCookie("not.a.jwt")).toBeNull()
    const ok = await signWith(REAL_SECRET, { sub: "u1" })
    expect(await readChatSessionCookie(`${ok}tampered`)).toBeNull()
  })

  it("returns null for a validly-signed token with an empty or blank sub", async () => {
    // An empty/blank sub would collapse every such identity onto the shared
    // `user:` memory partition (feat-208) — reject it, fail closed to anonymous.
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    expect(
      await readChatSessionCookie(await signWith(REAL_SECRET, { sub: "" })),
    ).toBeNull()
    expect(
      await readChatSessionCookie(await signWith(REAL_SECRET, { sub: "   " })),
    ).toBeNull()
  })

  it("returns null for an empty/undefined value", async () => {
    const { readChatSessionCookie } = await loadModule({ secret: REAL_SECRET })
    expect(await readChatSessionCookie(undefined)).toBeNull()
    expect(await readChatSessionCookie("")).toBeNull()
  })

  it("returns null with a MISSING signing secret and never accepts the value (fail-closed)", async () => {
    // A cookie that WOULD verify under a real secret must still read as null
    // when the app has no secret configured.
    const wouldBeValid = await signWith(REAL_SECRET, { sub: "u1" })
    const { readChatSessionCookie } = await loadModule({})
    expect(await readChatSessionCookie(wouldBeValid)).toBeNull()
  })
})

describe("createChatSessionCookie — fail-closed on weak/absent secret", () => {
  it("throws (no usable unsigned cookie) when the secret is missing", async () => {
    const { createChatSessionCookie } = await loadModule({})
    await expect(createChatSessionCookie({ sub: "u1" })).rejects.toThrow()
  })

  it("throws when the secret is the shipped placeholder", async () => {
    const { createChatSessionCookie } = await loadModule({
      secret: PLACEHOLDER,
    })
    await expect(createChatSessionCookie({ sub: "u1" })).rejects.toThrow()
  })
})

describe("cookie options (R11)", () => {
  it("session cookie is HttpOnly, SameSite=Lax, host-only, Path=/, non-Secure off-prod", async () => {
    const { chatSessionCookieOptions } = await loadModule({
      secret: REAL_SECRET,
      nodeEnv: "development",
    })
    const opts = chatSessionCookieOptions()
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe("lax")
    expect(opts.path).toBe("/")
    expect(opts.secure).toBe(false)
    expect("domain" in opts).toBe(false)
    expect(opts.maxAge).toBe(60 * 60 * 8)
  })

  it("is Secure in production", async () => {
    const { chatSessionCookieOptions } = await loadModule({
      secret: REAL_SECRET,
      nodeEnv: "production",
    })
    expect(chatSessionCookieOptions().secure).toBe(true)
  })

  it("transient cookies share the hardening but a ~10-minute TTL", async () => {
    const { transientCookieOptions } = await loadModule({ secret: REAL_SECRET })
    const opts = transientCookieOptions()
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe("lax")
    expect("domain" in opts).toBe(false)
    expect(opts.maxAge).toBe(60 * 10)
  })
})

describe("cookie names honor AUTH_COOKIE_PREFIX", () => {
  it("defaults to forge_chat", async () => {
    const { CHAT_SESSION_COOKIE } = await loadModule({ secret: REAL_SECRET })
    expect(CHAT_SESSION_COOKIE).toBe("forge_chat_session")
  })

  it("uses a custom prefix", async () => {
    const { CHAT_SESSION_COOKIE, CHAT_OAUTH_STATE_COOKIE } = await loadModule({
      secret: REAL_SECRET,
      prefix: "myapp",
    })
    expect(CHAT_SESSION_COOKIE).toBe("myapp_session")
    expect(CHAT_OAUTH_STATE_COOKIE).toBe("myapp_oauth_state")
  })
})
