import {
  authHeadersForOperation,
  buildAuthHeaders,
  FLEET_TOKEN_OPERATIONS,
  headersForOperation,
  overlappingAllowlistOperations,
  SEARCH_OPERATION_NAME,
  USER_TOKEN_OPERATIONS,
  userAuthHeadersForOperation,
  WATCH_EVENT_OPERATION_NAME,
} from "./authHeaders"

const FLEET = "fleet-key"
const USER = "user-access-token"

describe("buildAuthHeaders", () => {
  it("returns the anonymous shape with no token", () => {
    expect(buildAuthHeaders(undefined)).toEqual({})
  })

  it("returns a Bearer header with a token", () => {
    expect(buildAuthHeaders("k")).toEqual({ Authorization: "Bearer k" })
  })
})

describe("authHeadersForOperation (fleet-protection contract)", () => {
  it("attaches the bearer to the WatchSearch operation", () => {
    expect(authHeadersForOperation(SEARCH_OPERATION_NAME, "k")).toEqual({
      Authorization: "Bearer k",
    })
  })

  // The contract that protects the fleet's shared rate-limit bucket: a token must
  // never ride on a public operation, or the whole fleet funnels into one
  // consumer:<key> 60/min bucket on admin.
  it("sends NO header on public operations even when a token is set", () => {
    expect(authHeadersForOperation("GetWatchHomeVideos", "k")).toEqual({})
    // The home Experience query (R13/AE12) is public — a bearer here would pool
    // the whole fleet into admin's shared consumer:<key> rate-limit bucket.
    expect(authHeadersForOperation("GetWatchSetting", "k")).toEqual({})
    expect(authHeadersForOperation("GetSeriesBySlug", "k")).toEqual({})
    expect(authHeadersForOperation("GetVideoBySlug", "k")).toEqual({})
    expect(authHeadersForOperation(undefined, "k")).toEqual({})
  })

  it("sends no header on search when no token is provisioned (embargo default)", () => {
    expect(authHeadersForOperation(SEARCH_OPERATION_NAME, undefined)).toEqual(
      {},
    )
  })

  it("scopes to the current operation name, not the retired ones", () => {
    expect(SEARCH_OPERATION_NAME).toBe("WatchSearch")
    // The #1622 rename trap: the bearer kept riding "SemanticSearch" after the
    // query became WatchSearch, so it attached to nothing and every device fell
    // back to admin's coarse per-IP bucket.
    expect(authHeadersForOperation("SemanticSearch", "k")).toEqual({})
    expect(authHeadersForOperation("Search", "k")).toEqual({})
  })

  it("adds x-viewer-id on the search op alongside the bearer", () => {
    expect(
      authHeadersForOperation(SEARCH_OPERATION_NAME, "k", "device-1"),
    ).toEqual({ Authorization: "Bearer k", "x-viewer-id": "device-1" })
  })

  it("sends x-viewer-id on search even with no token (ready for provisioning)", () => {
    expect(
      authHeadersForOperation(SEARCH_OPERATION_NAME, undefined, "device-1"),
    ).toEqual({ "x-viewer-id": "device-1" })
  })

  it("never sends x-viewer-id on a public operation", () => {
    expect(
      authHeadersForOperation("GetWatchHomeVideos", "k", "device-1"),
    ).toEqual({})
  })
})

// ── U4.9: the signed-in viewer's bearer ─────────────────────────────────────

describe("userAuthHeadersForOperation (per-operation allowlist)", () => {
  it("attaches the user token to the watch-event write", () => {
    expect(
      userAuthHeadersForOperation(WATCH_EVENT_OPERATION_NAME, USER),
    ).toEqual({ Authorization: `Bearer ${USER}` })
  })

  // THE negative this unit exists to pin. Admin buckets search by the
  // credential presented, so a user bearer on WatchSearch moves the device out
  // of its consumer:<fleet-key>:v:<viewer_id> bucket and changes the
  // rate-limit identity the whole fleet is sized against.
  it("NEVER attaches the user token to WatchSearch", () => {
    expect(userAuthHeadersForOperation(SEARCH_OPERATION_NAME, USER)).toEqual({})
    expect(USER_TOKEN_OPERATIONS).not.toContain(SEARCH_OPERATION_NAME)
  })

  it("attaches to nothing else, signed in or not", () => {
    for (const op of [
      "GetWatchHomeVideos",
      "GetWatchSetting",
      "GetSeriesBySlug",
      "GetVideoBySlug",
      undefined,
    ]) {
      expect(userAuthHeadersForOperation(op, USER)).toEqual({})
    }
  })

  it("returns the anonymous shape when signed out", () => {
    expect(
      userAuthHeadersForOperation(WATCH_EVENT_OPERATION_NAME, undefined),
    ).toEqual({})
  })

  // The #1622 rename trap, one credential over: if the TV document's mutation
  // name drifts off this constant, every flush silently posts anonymously.
  it("pins the watch-event operation name", () => {
    expect(WATCH_EVENT_OPERATION_NAME).toBe("RecordWatchEvent")
    expect(WATCH_EVENT_OPERATION_NAME).not.toBe(SEARCH_OPERATION_NAME)
  })
})

describe("credential separation", () => {
  // The invariant that makes headersForOperation a selection rather than a
  // merge. Adding an op to both lists is the mistake this catches.
  it("keeps the two allowlists disjoint", () => {
    expect(overlappingAllowlistOperations()).toEqual([])
    expect(FLEET_TOKEN_OPERATIONS).toEqual([SEARCH_OPERATION_NAME])
    expect(USER_TOKEN_OPERATIONS).toEqual([WATCH_EVENT_OPERATION_NAME])
  })

  it("sends only the fleet bearer on search, even fully signed in", () => {
    expect(
      headersForOperation({
        operationName: SEARCH_OPERATION_NAME,
        fleetToken: FLEET,
        userAccessToken: USER,
        viewerId: "device-1",
      }),
    ).toEqual({ Authorization: `Bearer ${FLEET}`, "x-viewer-id": "device-1" })
  })

  // Falsification of the above: the composed header must carry the FLEET
  // value, not the user's. A substitution would typecheck and still be wrong.
  it("does not substitute the user token for the fleet token on search", () => {
    const headers = headersForOperation({
      operationName: SEARCH_OPERATION_NAME,
      fleetToken: FLEET,
      userAccessToken: USER,
    })
    expect(headers.Authorization).not.toContain(USER)
  })

  it("sends only the user bearer on the watch-event write", () => {
    expect(
      headersForOperation({
        operationName: WATCH_EVENT_OPERATION_NAME,
        fleetToken: FLEET,
        userAccessToken: USER,
        viewerId: "device-1",
      }),
    ).toEqual({ Authorization: `Bearer ${USER}` })
  })

  // The fleet key is baked into the binary and identifies no one; letting it
  // stand in for a signed-in viewer would post one person's watch history
  // under a credential every TV in the fleet holds.
  it("does not fall back to the fleet token when signed out", () => {
    expect(
      headersForOperation({
        operationName: WATCH_EVENT_OPERATION_NAME,
        fleetToken: FLEET,
        userAccessToken: undefined,
      }),
    ).toEqual({})
  })

  it("sends nothing on a public operation with both credentials present", () => {
    expect(
      headersForOperation({
        operationName: "GetWatchHomeVideos",
        fleetToken: FLEET,
        userAccessToken: USER,
        viewerId: "device-1",
      }),
    ).toEqual({})
  })

  // Fail-closed on a hypothetical allowlist overlap: send neither rather than
  // silently pick a winner.
  it("emits no Authorization when both allowlists would claim an operation", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    try {
      const overlapping = "OverlapOp"
      ;(FLEET_TOKEN_OPERATIONS as string[]).push(overlapping)
      ;(USER_TOKEN_OPERATIONS as string[]).push(overlapping)
      expect(
        headersForOperation({
          operationName: overlapping,
          fleetToken: FLEET,
          userAccessToken: USER,
        }),
      ).toEqual({})
      expect(spy).toHaveBeenCalled()
    } finally {
      ;(FLEET_TOKEN_OPERATIONS as string[]).pop()
      ;(USER_TOKEN_OPERATIONS as string[]).pop()
      spy.mockRestore()
    }
  })
})
