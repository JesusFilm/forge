import { beforeEach, describe, expect, it, vi } from "vitest"

const { proxyAgenticStudioRequestMock } = vi.hoisted(() => ({
  proxyAgenticStudioRequestMock: vi.fn(),
}))

vi.mock("@/lib/agentic-studio-proxy", () => ({
  proxyAgenticStudioRequest: proxyAgenticStudioRequestMock,
}))

import { GET, POST } from "./route"

describe("/api/agentic-studio route", () => {
  beforeEach(() => {
    proxyAgenticStudioRequestMock.mockReset()
    proxyAgenticStudioRequestMock.mockResolvedValue(
      new Response("proxied", { status: 200 }),
    )
  })

  it("passes catch-all params to the shared proxy", async () => {
    const response = await GET(
      new Request("https://manager.test/api/agentic-studio/api/agents"),
      { params: Promise.resolve({ path: ["api", "agents"] }) },
    )

    expect(response.status).toBe(200)
    expect(proxyAgenticStudioRequestMock).toHaveBeenCalledWith(
      expect.any(Request),
      { path: ["api", "agents"] },
    )
  })

  it("supports mutating requests through the same proxy", async () => {
    await POST(
      new Request("https://manager.test/api/agentic-studio/api/agents", {
        method: "POST",
        body: JSON.stringify({ name: "Agent" }),
      }),
      { params: Promise.resolve({ path: ["api", "agents"] }) },
    )

    expect(proxyAgenticStudioRequestMock).toHaveBeenCalledWith(
      expect.any(Request),
      { path: ["api", "agents"] },
    )
  })

  it("serves the Studio root through the optional catch-all route", async () => {
    await GET(new Request("https://manager.test/api/agentic-studio"), {
      params: Promise.resolve({}),
    })

    expect(proxyAgenticStudioRequestMock).toHaveBeenCalledWith(
      expect.any(Request),
      { path: [] },
    )
  })
})
