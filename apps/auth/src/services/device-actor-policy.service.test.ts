import { describe, expect, it, vi } from "vitest"

import { canActorApproveDevice } from "./device-actor-policy.service"

function prismaWith(
  user: unknown,
  environment: unknown = null,
): Parameters<typeof canActorApproveDevice>[0] {
  return {
    user: { findUnique: vi.fn(async () => user) },
    appEnvironment: { findUnique: vi.fn(async () => environment) },
  } as never
}

const approvedLocalEnvironment = {
  kind: "LOCAL",
  status: "APPROVED",
  app: { status: "ACTIVE" },
  grants: [{ id: "grant_1" }],
}

/**
 * The device grant is a second authorization surface. /oauth2/authorize already
 * refuses an AGENT actor on a production client; without this the same actor
 * could get there through a TV instead.
 */
describe("canActorApproveDevice", () => {
  it("admits a human on any client", async () => {
    await expect(
      canActorApproveDevice(prismaWith({ actorType: "HUMAN" }), {
        userId: "user_1",
        clientId: "jfp_tv_production",
      }),
    ).resolves.toBe(true)
  })

  it("refuses an agent on a production client", async () => {
    // The whole point: an agent session must not walk away with a production
    // access token plus a weeks-long refresh token.
    await expect(
      canActorApproveDevice(
        prismaWith(
          { actorType: "AGENT" },
          {
            ...approvedLocalEnvironment,
            kind: "PRODUCTION",
          },
        ),
        { userId: "agent_1", clientId: "jfp_tv_production" },
      ),
    ).resolves.toBe(false)
  })

  it("admits an agent on a non-production client it holds a grant for", async () => {
    // Anti-vacuous companion: proves the refusal above is about production and
    // grants, not a blanket agent ban that would make the other test pass for
    // the wrong reason.
    await expect(
      canActorApproveDevice(
        prismaWith({ actorType: "AGENT" }, approvedLocalEnvironment),
        { userId: "agent_1", clientId: "jfp_tv_local" },
      ),
    ).resolves.toBe(true)
  })

  it("refuses an agent with no approved grant", async () => {
    await expect(
      canActorApproveDevice(
        prismaWith(
          { actorType: "AGENT" },
          {
            ...approvedLocalEnvironment,
            grants: [],
          },
        ),
        { userId: "agent_1", clientId: "jfp_tv_local" },
      ),
    ).resolves.toBe(false)
  })

  it("refuses an agent when the client is unknown", async () => {
    await expect(
      canActorApproveDevice(prismaWith({ actorType: "AGENT" }, null), {
        userId: "agent_1",
        clientId: "nope",
      }),
    ).resolves.toBe(false)
  })

  it("fails closed when the user row is missing", async () => {
    await expect(
      canActorApproveDevice(prismaWith(null), {
        userId: "ghost",
        clientId: "jfp_tv_local",
      }),
    ).resolves.toBe(false)
  })
})
