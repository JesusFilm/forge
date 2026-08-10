import { print } from "graphql"

import { USER_TOKEN_OPERATIONS, FLEET_TOKEN_OPERATIONS } from "../authHeaders"
import { RECORD_WATCH_EVENT } from "./recordWatchEventDocument"

/**
 * The rename trap, pinned.
 *
 * `USER_TOKEN_OPERATIONS` allowlists the signed-in bearer BY NAME. If this
 * document is ever renamed without the constant following, the credential
 * detaches and every flush lands as an anonymous write — no error, no failing
 * request, just history quietly filed against nobody. #1622 did exactly this to
 * the search bearer one credential over.
 */
describe("RecordWatchEvent document", () => {
  const printed = print(RECORD_WATCH_EVENT)

  it("carries the operation name the user-token allowlist expects", () => {
    const match = printed.match(/mutation\s+(\w+)/)
    expect(match?.[1]).toBeDefined()
    expect(USER_TOKEN_OPERATIONS).toContain(match?.[1])
  })

  it("is NOT on the fleet-token allowlist", () => {
    // The two credentials are different things. A watch-event write carrying
    // the fleet key would file a person's history under the whole fleet's
    // shared identity.
    const match = printed.match(/mutation\s+(\w+)/)
    expect(FLEET_TOKEN_OPERATIONS).not.toContain(match?.[1])
  })

  it("sends the fields admin's recordWatchEvent needs to attribute a view", () => {
    for (const field of [
      "videoId",
      "videoDubId",
      "eventType",
      "positionSeconds",
      "durationSeconds",
      "progress",
      "requestSessionId",
      "occurredAt",
    ]) {
      expect(printed).toContain(field)
    }
  })

  it("passes occurredAt so a queued event keeps its ORIGINAL time", () => {
    // Without it the server stamps flush time, and a week of offline viewing
    // would collapse onto the moment the viewer happened to sign in.
    expect(printed).toContain("occurredAt: $occurredAt")
  })
})
