import { print } from "graphql"
import type { DocumentNode, OperationDefinitionNode } from "graphql"

import {
  FLEET_BEARER_OPERATION_NAMES,
  PROGRESS_OPERATION_NAMES,
  SEARCH_OPERATION_NAME,
  authHeadersForOperation,
  buildAuthHeaders,
  isProgressOperation,
} from "../authHeaders"
import {
  SUBMIT_FEEDBACK,
  SUBMIT_FEEDBACK_OPERATION_NAME,
} from "../feedbackQueries"
import {
  RECORD_WATCH_SEARCH_EVENT,
  WATCH_SEARCH,
  WATCH_SEARCH_EVENT_OPERATION_NAME,
} from "../queries"
import {
  GET_MY_WATCH_PROGRESS,
  UPSERT_MY_WATCH_PROGRESS,
} from "../watchProgressQueries"

// The consumer bearer must be attached whenever a token is configured, and the
// anonymous shape returned when it isn't, so the app still boots unprovisioned.
describe("buildAuthHeaders", () => {
  it("returns an Authorization bearer header when a token is set", () => {
    expect(buildAuthHeaders("abc123")).toEqual({
      Authorization: "Bearer abc123",
    })
  })

  it("returns no headers when the token is undefined", () => {
    expect(buildAuthHeaders(undefined)).toEqual({})
  })

  it("returns no headers when the token is empty", () => {
    expect(buildAuthHeaders("")).toEqual({})
  })
})

// The bearer must ride ONLY on the search operation. Every install ships the
// same baked-in key, so on other public ops it would collapse the whole fleet
// into one rate-limit bucket.
describe("authHeadersForOperation", () => {
  it("attaches the bearer for the WatchSearch operation", () => {
    expect(authHeadersForOperation("WatchSearch", "abc123")).toEqual({
      Authorization: "Bearer abc123",
    })
  })

  it("stays anonymous for public operations even with a token", () => {
    expect(authHeadersForOperation("GetVideoBySlug", "abc123")).toEqual({})
    expect(authHeadersForOperation("GetWatchSetting", "abc123")).toEqual({})
    expect(authHeadersForOperation(undefined, "abc123")).toEqual({})
  })

  it("stays anonymous for WatchSearch when no token is configured", () => {
    expect(authHeadersForOperation("WatchSearch", undefined)).toEqual({})
    expect(authHeadersForOperation("WatchSearch", "")).toEqual({})
  })

  it("adds x-viewer-id on the WatchSearch op alongside the bearer", () => {
    expect(
      authHeadersForOperation("WatchSearch", "abc123", "device-1"),
    ).toEqual({
      Authorization: "Bearer abc123",
      "x-viewer-id": "device-1",
    })
  })

  it("sends x-viewer-id on WatchSearch even with no token (ready for provisioning)", () => {
    expect(
      authHeadersForOperation("WatchSearch", undefined, "device-1"),
    ).toEqual({
      "x-viewer-id": "device-1",
    })
  })

  it("never sends x-viewer-id on a public operation", () => {
    expect(
      authHeadersForOperation("GetVideoBySlug", "abc123", "device-1"),
    ).toEqual({})
  })
})

// KTD3. `submitFeedback` is a PUBLIC resolver too, so the bearer is not access
// here either — it buys the per-install bucket admin's 5-per-10-minutes limit
// counts in (R14). Without x-viewer-id every install behind one carrier egress
// shares a bucket and a busy address refuses a stranger's first submission.
describe("SubmitFeedback rides the fleet bearer", () => {
  it("sends the bearer and x-viewer-id", () => {
    expect(
      authHeadersForOperation(
        SUBMIT_FEEDBACK_OPERATION_NAME,
        "abc123",
        "device-1",
      ),
    ).toEqual({
      Authorization: "Bearer abc123",
      "x-viewer-id": "device-1",
    })
  })

  // R3: signed in or out, the submission still carries the install's bucket.
  it("sends x-viewer-id with no token configured", () => {
    expect(
      authHeadersForOperation(
        SUBMIT_FEEDBACK_OPERATION_NAME,
        undefined,
        "device-1",
      ),
    ).toEqual({ "x-viewer-id": "device-1" })
  })

  // KTD10: the user JWT rides only the progress operations. Feedback is public
  // and must never carry it, and the progress ops must never gain the fleet key.
  it("stays out of the user-JWT gate, and the progress ops stay out of this one", () => {
    expect(isProgressOperation(SUBMIT_FEEDBACK_OPERATION_NAME)).toBe(false)
    for (const name of PROGRESS_OPERATION_NAMES) {
      expect(authHeadersForOperation(name, "abc123", "device-1")).toEqual({})
    }
  })

  // The gate matches on the operation NAME: renaming the mutation without the
  // constant drops feedback into the shared public:<ip> bucket (#1622's class).
  it("pins the constant to the document actually sent", () => {
    const doc = SUBMIT_FEEDBACK as unknown as DocumentNode
    const operation = doc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    )
    expect(operation?.name?.value).toBe(SUBMIT_FEEDBACK_OPERATION_NAME)
  })

  // The allowlist is an ENUMERATION, not a policy. Pinning its whole contents
  // makes widening it a deliberate edit to this line.
  it("admits exactly the two operations that need the per-install bucket", () => {
    expect([...FLEET_BEARER_OPERATION_NAMES].sort()).toEqual(
      [SEARCH_OPERATION_NAME, SUBMIT_FEEDBACK_OPERATION_NAME].sort(),
    )
  })
})

// Regression guard for the #1622 class of bug: the bearer gate matches on the
// operation NAME, so renaming the search query without updating
// SEARCH_OPERATION_NAME silently drops mobile into the shared public:<ip>
// rate-limit bucket. Pin the two together.
describe("SEARCH_OPERATION_NAME ↔ WATCH_SEARCH", () => {
  it("matches the name of the operation actually sent", () => {
    const doc = WATCH_SEARCH as unknown as DocumentNode
    const operation = doc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    )
    expect(operation?.name?.value).toBe(SEARCH_OPERATION_NAME)
  })

  it("queries watchSearch, never the retired Query.search", () => {
    const sdl = print(WATCH_SEARCH as unknown as DocumentNode)
    expect(sdl).toContain("watchSearch(input: $input)")
    expect(sdl).not.toMatch(/\bsearch\(q:/)
  })
})

// KTD10: the signed-in user JWT rides ONLY the progress operations — the
// same op-scoping law as the fleet search bearer. Pinning the set to what is
// actually sent stops a rename silently widening or stranding the token.
describe("isProgressOperation gate", () => {
  it("admits exactly the two progress operations", () => {
    expect(isProgressOperation("MyWatchProgress")).toBe(true)
    expect(isProgressOperation("UpsertMyWatchProgress")).toBe(true)
  })

  it("no longer admits the retired clear operation", () => {
    // Its client half is gone; admin keeps the mutation for future parity.
    expect(isProgressOperation("ClearMyWatchProgress")).toBe(false)
  })

  it("rejects public operations — the user JWT never rides them", () => {
    for (const name of [
      "WatchSearch",
      "GetVideoBySlug",
      "GetWatchSetting",
      "GetExperienceBySlug",
      "GetWatchHomeVideos",
      undefined,
    ]) {
      expect(isProgressOperation(name)).toBe(false)
    }
  })

  it("matches the operation names actually sent", () => {
    const docs = [GET_MY_WATCH_PROGRESS, UPSERT_MY_WATCH_PROGRESS]
    const sentNames = docs.map((doc) => {
      const operation = (doc as unknown as DocumentNode).definitions.find(
        (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
      )
      return operation?.name?.value
    })
    expect(sentNames.sort()).toEqual([...PROGRESS_OPERATION_NAMES].sort())
  })

  it("never selects dubs in the progress fragments (standing guard)", () => {
    for (const doc of [GET_MY_WATCH_PROGRESS, UPSERT_MY_WATCH_PROGRESS]) {
      expect(print(doc as unknown as DocumentNode)).not.toMatch(/\bdubs\b/)
    }
  })
})

// The event mutation is public fire-and-forget telemetry; a bearer on it would
// spend the fleet key's per-device search budget once per tap (KTD6).
describe("RecordWatchSearchEvent rides without the fleet bearer", () => {
  it("returns no headers for the event mutation even fully provisioned", () => {
    expect(
      authHeadersForOperation(
        WATCH_SEARCH_EVENT_OPERATION_NAME,
        "abc123",
        "device-1",
      ),
    ).toEqual({})
  })

  // The bearer gate and apolloClient's RUM-error exemption both match on the
  // operation NAME: renaming the mutation toward "WatchSearch" would spend the
  // fleet key per tap; renaming it off the constant would un-shed RUM errors.
  it("pins the mutation document's name to the exemption constant", () => {
    const doc = RECORD_WATCH_SEARCH_EVENT as unknown as DocumentNode
    const operation = doc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    )
    expect(operation?.name?.value).toBe(WATCH_SEARCH_EVENT_OPERATION_NAME)
    expect(operation?.name?.value).not.toBe(SEARCH_OPERATION_NAME)
  })
})
