import { describe, expect, it } from "vitest"

import { instanceTags, resolveInstanceIdentity } from "./instance-identity"

describe("resolveInstanceIdentity", () => {
  it("uses Railway's replica and deployment ids", () => {
    // Values shaped like production on 2026-10-19 (feat-745); the replica id
    // equals the `deploymentInstanceId` in Railway's HTTP logs.
    const identity = resolveInstanceIdentity(
      {
        RAILWAY_REPLICA_ID: "7116eeca-d7e5-4b55-8273-4b134bbc3b16",
        RAILWAY_DEPLOYMENT_ID: "772be46d-0d78-4faa-aa5e-43b8d5e010d2",
      },
      () => "ignored",
    )

    expect(instanceTags(identity)).toEqual({
      replica_id: "7116eeca-d7e5-4b55-8273-4b134bbc3b16",
      deployment_id: "772be46d-0d78-4faa-aa5e-43b8d5e010d2",
    })
  })

  it("falls back to the container hostname outside Railway", () => {
    expect(
      instanceTags(resolveInstanceIdentity({}, () => "b06484305485")),
    ).toEqual({ replica_id: "b06484305485" })
  })

  it("keeps tag values bounded and tag-safe", () => {
    const identity = resolveInstanceIdentity(
      { RAILWAY_REPLICA_ID: ` a b,c|${"x".repeat(100)} ` },
      () => "",
    )

    expect(identity.replicaId).toMatch(/^[a-z0-9_.:/-]+$/i)
    expect(identity.replicaId).toHaveLength(64)
  })

  it("never emits an empty replica id", () => {
    expect(
      resolveInstanceIdentity({ RAILWAY_REPLICA_ID: " " }, () => ""),
    ).toEqual({ replicaId: "unknown" })
  })
})
