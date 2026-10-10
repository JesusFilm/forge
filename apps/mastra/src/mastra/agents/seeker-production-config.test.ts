import { describe, expect, it } from "vitest"

import {
  buildSeekerProductionIdentity,
  serializeSeekerProductionIdentity,
  SEEKER_PRODUCTION_PROMPT,
} from "./seeker-production-config"

describe("seeker production identity", () => {
  it("serializes a stable provider-neutral prompt pin and ordered default routes", () => {
    const identity = buildSeekerProductionIdentity({ gatewayEnabled: false })

    expect(identity.prompt).toEqual(SEEKER_PRODUCTION_PROMPT)
    expect(identity.prompt).toEqual({
      provider: "langfuse",
      name: "seeker-system",
      revision: "3",
      contentHash:
        "fb79743a2a6068cb2ec030694ec73f025a6a74ae617ef5e0bdd8ddc2e81099d2",
    })
    expect(identity.models.routes.map((route) => route.model)).toEqual([
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
    ])
    expect(serializeSeekerProductionIdentity(identity)).toBe(
      serializeSeekerProductionIdentity(
        buildSeekerProductionIdentity({ gatewayEnabled: false }),
      ),
    )
  })

  it("represents gateway routing variations instead of collapsing to a model slug", () => {
    const disabled = buildSeekerProductionIdentity({ gatewayEnabled: false })
    const enabled = buildSeekerProductionIdentity({
      gatewayEnabled: true,
      gatewayBaseUrl: "https://gateway.example/v1",
      gatewayModel: "custom",
    })

    expect(enabled.models.routes[0]).toMatchObject({
      provider: "jesusfilm",
      model: "custom",
      endpoint: "chat-completions",
      baseUrl: "https://gateway.example/v1",
      maxRetries: 0,
    })
    expect(serializeSeekerProductionIdentity(enabled)).not.toBe(
      serializeSeekerProductionIdentity(disabled),
    )
  })

  it("does not include unrelated environment values in the fixed identity", () => {
    expect(
      serializeSeekerProductionIdentity(
        buildSeekerProductionIdentity({ gatewayEnabled: false }),
      ),
    ).not.toContain("LANGFUSE_PROMPT_DEFAULT_LABEL")
  })
})
