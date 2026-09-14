import { generateKeyPairSync } from "node:crypto"
import { afterEach, expect, it, vi } from "vitest"

const configuration = vi.hoisted(() => ({
  MANAGER_BASE_URL: "https://manager.test",
  ADMIN_GRAPHQL_URL: "https://admin.test/api/graphql",
  STUDIO_INTERACTIVE_KEY_ID: "test-key",
  STUDIO_INTERACTIVE_PRIVATE_KEY: "",
  STUDIO_ENVIRONMENT: "local",
}))
vi.mock("@/config/env", () => ({ env: configuration }))
vi.mock("@/lib/auth", () => ({
  authenticateInteractiveManagerRequest: async () => ({
    approvedByUserId: "operator",
  }),
}))
import { POST } from "./route"
import { studioCall, StudioClientError } from "@/features/video-studio/client"

afterEach(() => vi.unstubAllGlobals())

it("preserves canonical non-commit rejection through both HTTP adapters without classifying receipt conflicts or lost responses as safe to replace", async () => {
  configuration.STUDIO_INTERACTIVE_PRIVATE_KEY = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
  let canonicalResponse = () =>
    Promise.resolve(
      Response.json(
        { error: "UNREADY", publicationRejected: true },
        { status: 409 },
      ),
    )
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    if (String(url) === "/api/shorts/command") {
      return POST(
        new Request("https://manager.test/api/shorts/command", {
          ...init,
          headers: { ...init.headers, origin: "https://manager.test" },
        }),
      )
    }
    expect(String(url)).toBe("https://admin.test/api/shorts/interactive")
    expect(
      new Headers(init.headers).get("x-forge-shorts-interactive"),
    ).toBeTruthy()
    return canonicalResponse()
  })
  await expect(studioCall("publish", {})).rejects.toMatchObject({
    status: 409,
    message: "UNREADY",
    publicationRejected: true,
  })
  canonicalResponse = async () =>
    Response.json({ error: "CONFLICT" }, { status: 409 })
  await expect(studioCall("publish", {})).rejects.toMatchObject({
    status: 409,
    message: "CONFLICT",
    publicationRejected: false,
  })
  canonicalResponse = async () => {
    throw new Error("response lost after commit")
  }
  await expect(studioCall("publish", {})).rejects.toBeInstanceOf(
    StudioClientError,
  )
  await expect(studioCall("publish", {})).rejects.toMatchObject({
    publicationRejected: false,
  })
})
