import * as safeStorage from "../safeStorage"
import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  DISPLAY_NAME_STORAGE_KEY,
  MAX_DISPLAY_NAME_CHARS,
  MAX_ID_TOKEN_CHARS,
  MAX_USERINFO_RESPONSE_CHARS,
  USERINFO_PATH,
  buildAuthEndpointUrl,
  cacheIdentityDisplayName,
  clearCachedDisplayName,
  decodeIdTokenClaimsUnverified,
  fetchUserInfo,
  isAllowedAuthOrigin,
  isServerVerifiedIdentity,
  preferredDisplayName,
  readCachedDisplayName,
  resolveTvIdentity,
  sanitizeAvatarUrl,
  sanitizeIdpText,
  writeCachedDisplayName,
  type FetchLike,
  type TvIdentity,
} from "./profile"

// getStorage() warns once per reset when AsyncStorage isn't linked (always,
// under jest). The insecure-origin guard warns too. Silence both.
beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
})

const BASE = "https://auth.jesusfilm.org"
const TOKEN = "at_abc123"

/** Minimal fetch double: records the call and replays a canned response. */
function stubFetch(
  response: { ok?: boolean; status?: number; body?: string } | Error,
): FetchLike & { calls: { url: string; init?: Parameters<FetchLike>[1] }[] } {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = []
  const impl = (async (url, init) => {
    calls.push({ url, init })
    if (response instanceof Error) throw response
    const status = response.status ?? 200
    return {
      ok: response.ok ?? (status >= 200 && status < 300),
      status,
      text: async () => response.body ?? "{}",
    }
  }) as FetchLike & { calls: typeof calls }
  impl.calls = calls
  return impl
}

function userInfoBody(claims: Record<string, unknown>): string {
  return JSON.stringify(claims)
}

const B64_STANDARD =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/**
 * UTF-8 → unpadded base64url. Hand-rolled rather than via Node's Buffer for
 * two reasons: apps/tv ships no @types/node (Buffer is a typecheck error), and
 * an independent encoder means the module's decoder is not being tested by its
 * own implementation.
 */
function b64url(value: string): string {
  const bytes: number[] = []
  for (const char of value) {
    const cp = char.codePointAt(0) as number
    if (cp < 0x80) bytes.push(cp)
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000)
      bytes.push(
        0xe0 | (cp >> 12),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
  }
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64_STANDARD[(n >> 18) & 63] + B64_STANDARD[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64_STANDARD[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64_STANDARD[n & 63]
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_")
}

/** Build a real 3-part compact JWS with an arbitrary payload. */
function makeIdToken(payload: Record<string, unknown>): string {
  return [
    b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" })),
    b64url(JSON.stringify(payload)),
    "c2lnbmF0dXJl",
  ].join(".")
}

describe("buildAuthEndpointUrl", () => {
  it("joins base and path", () => {
    expect(buildAuthEndpointUrl(BASE, USERINFO_PATH)).toBe(
      "https://auth.jesusfilm.org/api/auth/oauth2/userinfo",
    )
  })

  // A base URL pasted into a Railway/EAS env var with a trailing slash is the
  // normal operator slip; "//api/auth/..." would 404 on every TV in the fleet.
  it("tolerates trailing slashes on the base", () => {
    expect(buildAuthEndpointUrl(`${BASE}/`, USERINFO_PATH)).toBe(
      "https://auth.jesusfilm.org/api/auth/oauth2/userinfo",
    )
    expect(buildAuthEndpointUrl(`${BASE}///`, USERINFO_PATH)).toBe(
      "https://auth.jesusfilm.org/api/auth/oauth2/userinfo",
    )
  })

  it("pins the userinfo path apps/auth publishes", () => {
    expect(USERINFO_PATH).toBe("/api/auth/oauth2/userinfo")
  })
})

describe("isAllowedAuthOrigin", () => {
  it("always allows https", () => {
    expect(isAllowedAuthOrigin("https://auth.jesusfilm.org/x", false)).toBe(
      true,
    )
  })

  // The access token is a bearer credential; http would put it on the wire in
  // the clear. Only a dev build (which passes true) may do that.
  it("refuses http unless the caller allows insecure origins", () => {
    expect(isAllowedAuthOrigin("http://localhost:3000/x", false)).toBe(false)
    expect(isAllowedAuthOrigin("http://localhost:3000/x", true)).toBe(true)
  })

  it("refuses every non-http(s) scheme even in dev", () => {
    expect(isAllowedAuthOrigin("file:///etc/passwd", true)).toBe(false)
    expect(isAllowedAuthOrigin("javascript:alert(1)", true)).toBe(false)
    expect(isAllowedAuthOrigin("not a url", true)).toBe(false)
  })
})

describe("sanitizeIdpText", () => {
  it("returns undefined for non-strings and empties", () => {
    expect(sanitizeIdpText(undefined, 10)).toBeUndefined()
    expect(sanitizeIdpText(42, 10)).toBeUndefined()
    expect(sanitizeIdpText("   ", 10)).toBeUndefined()
  })

  // A newline in a name would break the 10-foot layout; a zero-width joiner or
  // an RTL override would let an IdP-supplied name reorder the row it sits in.
  it("strips control characters and bidi/zero-width marks", () => {
    expect(sanitizeIdpText("Ada\nLovelace", 64)).toBe("Ada Lovelace")
    expect(sanitizeIdpText("Ada\u202eLovelace", 64)).toBe("Ada Lovelace")
    expect(sanitizeIdpText("Ada\u200bLovelace", 64)).toBe("Ada Lovelace")
  })

  it("caps length", () => {
    expect(sanitizeIdpText("a".repeat(100), 10)).toBe("a".repeat(10))
  })

  // Slicing UTF-16 in the middle of an astral pair renders a replacement box.
  it("drops a trailing lone high surrogate left by the cap", () => {
    const withEmoji = `abcd${"\u{1F600}"}`
    expect(sanitizeIdpText(withEmoji, 5)).toBe("abcd")
  })

  it("keeps non-Latin names intact", () => {
    expect(sanitizeIdpText("สมชาย ใจดี", 64)).toBe("สมชาย ใจดี")
  })
})

describe("sanitizeAvatarUrl", () => {
  it("accepts https", () => {
    expect(sanitizeAvatarUrl("https://cdn.example/a.png")).toBe(
      "https://cdn.example/a.png",
    )
  })

  it("rejects everything else", () => {
    expect(sanitizeAvatarUrl("http://cdn.example/a.png")).toBeUndefined()
    expect(sanitizeAvatarUrl("data:image/png;base64,AAAA")).toBeUndefined()
    expect(sanitizeAvatarUrl("javascript:alert(1)")).toBeUndefined()
    expect(sanitizeAvatarUrl(undefined)).toBeUndefined()
  })
})

describe("fetchUserInfo", () => {
  it("GETs the userinfo endpoint with the access token as a bearer", async () => {
    const impl = stubFetch({ body: userInfoBody({ sub: "user-1" }) })
    await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      fetchImpl: impl,
    })

    expect(impl.calls).toHaveLength(1)
    expect(impl.calls[0].url).toBe(
      "https://auth.jesusfilm.org/api/auth/oauth2/userinfo",
    )
    expect(impl.calls[0].init?.method).toBe("GET")
    expect(impl.calls[0].init?.headers?.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it("maps the claims onto a server-verified identity", async () => {
    const impl = stubFetch({
      body: userInfoBody({
        sub: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.org",
        picture: "https://cdn.example/a.png",
        email_verified: true,
      }),
    })
    const result = await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      fetchImpl: impl,
    })

    expect(result).toEqual({
      kind: "ok",
      identity: {
        source: "userinfo",
        subject: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.org",
        picture: "https://cdn.example/a.png",
        emailVerified: true,
      },
    })
    if (result.kind !== "ok") throw new Error("unreachable")
    expect(isServerVerifiedIdentity(result.identity)).toBe(true)
  })

  // The string "true" must never read as a verified email.
  it("only accepts a strict boolean for email_verified", async () => {
    const impl = stubFetch({
      body: userInfoBody({ sub: "user-1", email_verified: "true" }),
    })
    const result = await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      fetchImpl: impl,
    })
    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.identity.emailVerified).toBeUndefined()
  })

  // These two outcomes drive different recoveries: refresh/sign-out vs retry.
  // Collapsing them would sign a viewer out over flaky hotel wifi.
  it("distinguishes a rejected token from an unreachable endpoint", async () => {
    for (const status of [401, 403]) {
      const result = await fetchUserInfo({
        authBaseUrl: BASE,
        accessToken: TOKEN,
        fetchImpl: stubFetch({ status }),
      })
      expect(result).toEqual({ kind: "unauthorized" })
    }
    for (const status of [500, 502, 404]) {
      const result = await fetchUserInfo({
        authBaseUrl: BASE,
        accessToken: TOKEN,
        fetchImpl: stubFetch({ status }),
      })
      expect(result).toEqual({ kind: "unavailable" })
    }
  })

  it("treats an empty access token as unauthorized without calling out", async () => {
    const impl = stubFetch({ body: userInfoBody({ sub: "user-1" }) })
    const result = await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: "",
      fetchImpl: impl,
    })
    expect(result).toEqual({ kind: "unauthorized" })
    expect(impl.calls).toHaveLength(0)
  })

  // Every async tick that can reject must be inside try/catch — in dev an
  // unhandled rejection escalates to an all-native RCTFatal with no JS message.
  it("never throws on a transport failure", async () => {
    await expect(
      fetchUserInfo({
        authBaseUrl: BASE,
        accessToken: TOKEN,
        fetchImpl: stubFetch(new Error("Network request failed")),
      }),
    ).resolves.toEqual({ kind: "unavailable" })
  })

  it("never throws on a malformed body", async () => {
    for (const body of ["not json", "[]", '"a string"', "null"]) {
      await expect(
        fetchUserInfo({
          authBaseUrl: BASE,
          accessToken: TOKEN,
          fetchImpl: stubFetch({ body }),
        }),
      ).resolves.toEqual({ kind: "unavailable" })
    }
  })

  // A subject-less body is a broken response, not a signed-out user.
  it("refuses a body with no sub", async () => {
    const result = await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      fetchImpl: stubFetch({ body: userInfoBody({ name: "Ada" }) }),
    })
    expect(result).toEqual({ kind: "unavailable" })
  })

  it("refuses an over-cap body instead of parsing it", async () => {
    const huge = `{"sub":"user-1","name":"${"a".repeat(MAX_USERINFO_RESPONSE_CHARS)}"}`
    const result = await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      fetchImpl: stubFetch({ body: huge }),
    })
    expect(result).toEqual({ kind: "unavailable" })
  })

  // The bearer must never leave the device over plain http in a release build.
  it("refuses to send the bearer to an insecure origin", async () => {
    const impl = stubFetch({ body: userInfoBody({ sub: "user-1" }) })
    const result = await fetchUserInfo({
      authBaseUrl: "http://auth.example.org",
      accessToken: TOKEN,
      allowInsecureOrigin: false,
      fetchImpl: impl,
    })
    expect(result).toEqual({ kind: "unavailable" })
    expect(impl.calls).toHaveLength(0)
  })

  // Pins the DEFAULT source of that flag. Half of this pair is vacuous alone:
  // jest-expo sets __DEV__ true, so the permissive case cannot tell
  // `= __DEV__` from a hardcoded `= true` — and a one-line edit to the latter
  // would fail every RELEASE build open with the whole suite green. The second
  // case flips the global (the default expression is evaluated per call) so
  // only a real __DEV__ read passes both.
  it("defaults the insecure-origin allowance to __DEV__", async () => {
    expect(__DEV__).toBe(true)
    const impl = stubFetch({ body: userInfoBody({ sub: "user-1" }) })
    const result = await fetchUserInfo({
      authBaseUrl: "http://localhost:3000",
      accessToken: TOKEN,
      fetchImpl: impl,
    })
    expect(result.kind).toBe("ok")
    expect(impl.calls).toHaveLength(1)
  })

  it("denies http by default once __DEV__ is false (the release posture)", async () => {
    const globals = globalThis as unknown as { __DEV__: boolean }
    const original = globals.__DEV__
    globals.__DEV__ = false
    try {
      const impl = stubFetch({ body: userInfoBody({ sub: "user-1" }) })
      const result = await fetchUserInfo({
        authBaseUrl: "http://localhost:3000",
        accessToken: TOKEN,
        fetchImpl: impl,
      })
      expect(result).toEqual({ kind: "unavailable" })
      expect(impl.calls).toHaveLength(0)
    } finally {
      globals.__DEV__ = original
    }
  })

  it("aborts the request when the budget expires", async () => {
    let seen: AbortSignal | undefined
    const impl: FetchLike = async (_url, init) => {
      seen = init?.signal
      await new Promise((resolve) => setTimeout(resolve, 50))
      throw new Error("aborted")
    }
    const result = await fetchUserInfo({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      timeoutMs: 1,
      fetchImpl: impl,
    })
    expect(result).toEqual({ kind: "unavailable" })
    expect(seen?.aborted).toBe(true)
  })
})

describe("decodeIdTokenClaimsUnverified", () => {
  it("tags what it produces as unverified, never as userinfo", () => {
    const identity = decodeIdTokenClaimsUnverified(
      makeIdToken({ sub: "user-1", name: "Ada Lovelace" }),
    )
    expect(identity).toEqual({
      source: "id_token_unverified",
      subject: "user-1",
      name: "Ada Lovelace",
      email: undefined,
      picture: undefined,
      emailVerified: undefined,
    })
    // The whole point of the source tag: this must not pass a trust check.
    expect(isServerVerifiedIdentity(identity as TvIdentity)).toBe(false)
  })

  // base64url is not base64: a name with a "+"-mapping byte decodes to mojibake
  // if the alphabet swap is skipped.
  it("decodes base64url payloads, including non-Latin names", () => {
    const identity = decodeIdTokenClaimsUnverified(
      makeIdToken({ sub: "u", name: "สมชาย ใจดี 😀" }),
    )
    expect(identity?.name).toBe("สมชาย ใจดี 😀")
  })

  it("returns null for anything that is not a 3-part JWS", () => {
    expect(decodeIdTokenClaimsUnverified(undefined)).toBeNull()
    expect(decodeIdTokenClaimsUnverified(null)).toBeNull()
    expect(decodeIdTokenClaimsUnverified("")).toBeNull()
    expect(decodeIdTokenClaimsUnverified("a.b")).toBeNull()
    // A 5-part JWE is encrypted; there is nothing to read.
    expect(decodeIdTokenClaimsUnverified("a.b.c.d.e")).toBeNull()
  })

  it("returns null for a payload that is not base64url", () => {
    expect(decodeIdTokenClaimsUnverified("aaa.!!!!.ccc")).toBeNull()
  })

  it("returns null for a payload that is not a JSON object", () => {
    expect(decodeIdTokenClaimsUnverified(`h.${b64url("[1,2,3]")}.s`)).toBeNull()
    expect(decodeIdTokenClaimsUnverified(`h.${b64url("nope")}.s`)).toBeNull()
  })

  it("returns null when the payload carries no sub", () => {
    expect(
      decodeIdTokenClaimsUnverified(makeIdToken({ name: "Ada" })),
    ).toBeNull()
  })

  it("refuses an absurdly long token instead of decoding it", () => {
    const token = makeIdToken({
      sub: "u",
      name: "a".repeat(MAX_ID_TOKEN_CHARS),
    })
    expect(token.length).toBeGreaterThan(MAX_ID_TOKEN_CHARS)
    expect(decodeIdTokenClaimsUnverified(token)).toBeNull()
  })

  it("sanitises claims exactly like the userinfo path", () => {
    const identity = decodeIdTokenClaimsUnverified(
      makeIdToken({
        sub: "u",
        name: `Ada\n${"x".repeat(MAX_DISPLAY_NAME_CHARS)}`,
        picture: "javascript:alert(1)",
      }),
    )
    expect(identity?.name).toHaveLength(MAX_DISPLAY_NAME_CHARS)
    expect(identity?.name).not.toContain("\n")
    expect(identity?.picture).toBeUndefined()
  })
})

describe("cached display name", () => {
  it("round-trips through regular storage", async () => {
    await writeCachedDisplayName("Ada Lovelace")
    expect(await readCachedDisplayName()).toBe("Ada Lovelace")
    expect(await getStorage().getItem(DISPLAY_NAME_STORAGE_KEY)).toBe(
      "Ada Lovelace",
    )
  })

  it("returns undefined when nothing is cached", async () => {
    expect(await readCachedDisplayName()).toBeUndefined()
  })

  // A value written by an older, looser build must not reach the screen raw.
  it("re-sanitises on read", async () => {
    await getStorage().setItem(DISPLAY_NAME_STORAGE_KEY, "Ada\nLovelace")
    expect(await readCachedDisplayName()).toBe("Ada Lovelace")
  })

  it("removes the key rather than storing an empty name", async () => {
    await writeCachedDisplayName("Ada")
    await writeCachedDisplayName("   ")
    expect(await getStorage().getItem(DISPLAY_NAME_STORAGE_KEY)).toBeNull()
  })

  // Account isolation on a shared family TV: the cached name is the PREVIOUS
  // viewer's, so sign-out must be able to erase it.
  it("clears on demand", async () => {
    await writeCachedDisplayName("Ada")
    await clearCachedDisplayName()
    expect(await readCachedDisplayName()).toBeUndefined()
  })

  // Same isolation rule, second door: signing in as an account with no name
  // must not inherit the previous account's label.
  it("clears when the new identity has no name", async () => {
    await writeCachedDisplayName("Ada")
    await cacheIdentityDisplayName({ source: "userinfo", subject: "user-2" })
    expect(await readCachedDisplayName()).toBeUndefined()
  })

  it("never throws when storage is unavailable", async () => {
    const failing = {
      getItem: async () => {
        throw new Error("no keychain")
      },
      setItem: async () => {
        throw new Error("no keychain")
      },
      removeItem: async () => {
        throw new Error("no keychain")
      },
    }
    const spy = jest.spyOn(safeStorage, "getStorage").mockReturnValue(failing)
    try {
      await expect(writeCachedDisplayName("Ada")).resolves.toBeUndefined()
      await expect(readCachedDisplayName()).resolves.toBeUndefined()
      await expect(clearCachedDisplayName()).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })
})

describe("preferredDisplayName", () => {
  it("prefers the name, falls back to the email", () => {
    expect(
      preferredDisplayName({
        source: "userinfo",
        subject: "u",
        name: "Ada",
        email: "ada@example.org",
      }),
    ).toBe("Ada")
    expect(
      preferredDisplayName({
        source: "userinfo",
        subject: "u",
        email: "ada@example.org",
      }),
    ).toBe("ada@example.org")
    expect(
      preferredDisplayName({ source: "userinfo", subject: "u" }),
    ).toBeUndefined()
  })
})

describe("resolveTvIdentity", () => {
  it("prefers userinfo and caches the name for the next cold launch", async () => {
    const result = await resolveTvIdentity({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      idToken: makeIdToken({ sub: "user-1", name: "Stale Name" }),
      fetchImpl: stubFetch({
        body: userInfoBody({ sub: "user-1", name: "Ada Lovelace" }),
      }),
    })

    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.identity.source).toBe("userinfo")
    expect(result.identity.name).toBe("Ada Lovelace")
    expect(await readCachedDisplayName()).toBe("Ada Lovelace")
  })

  it("falls back to the unverified decode when the endpoint is unreachable", async () => {
    const result = await resolveTvIdentity({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      idToken: makeIdToken({ sub: "user-1", name: "Ada Lovelace" }),
      fetchImpl: stubFetch(new Error("Network request failed")),
    })

    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.identity.source).toBe("id_token_unverified")
    expect(result.identity.name).toBe("Ada Lovelace")
  })

  // The load-bearing asymmetry: a REJECTED token means the session is dead.
  // Synthesising an identity from a stale id_token there would paint a dead
  // session as a live one and hide the state the caller must act on.
  it("does NOT fall back when the access token was rejected", async () => {
    const result = await resolveTvIdentity({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      idToken: makeIdToken({ sub: "user-1", name: "Ada Lovelace" }),
      fetchImpl: stubFetch({ status: 401 }),
    })
    expect(result).toEqual({ kind: "unauthorized" })
  })

  // A network blip must not blank a name that is still correct.
  it("leaves the cached name alone when both paths fail", async () => {
    await writeCachedDisplayName("Ada Lovelace")
    const result = await resolveTvIdentity({
      authBaseUrl: BASE,
      accessToken: TOKEN,
      fetchImpl: stubFetch(new Error("Network request failed")),
    })
    expect(result).toEqual({ kind: "unavailable" })
    expect(await readCachedDisplayName()).toBe("Ada Lovelace")
  })

  it("never throws", async () => {
    await expect(
      resolveTvIdentity({
        authBaseUrl: "::::not a url::::",
        accessToken: TOKEN,
        fetchImpl: stubFetch(new Error("boom")),
      }),
    ).resolves.toEqual({ kind: "unavailable" })
  })
})
