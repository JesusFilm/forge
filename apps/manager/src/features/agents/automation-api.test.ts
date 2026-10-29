import { afterEach, describe, expect, it, vi } from "vitest"
import { requestAutomation } from "./automation-api"

const fetchMock = vi.fn()
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => fetchMock(...args),
}))

afterEach(() => fetchMock.mockReset())

describe("automation API responses", () => {
  it.each([200, 502, 503])(
    "handles an HTML response with HTTP %i",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response("<!DOCTYPE html><title>Unavailable</title>", {
          status,
          headers: { "Content-Type": "text/html" },
        }),
      )
      await expect(
        requestAutomation(
          "/api/automations",
          {},
          "Automation was not created.",
        ),
      ).rejects.toThrow(
        `Automation was not created. The server returned an unexpected response (HTTP ${status}). Refresh the page and try again.`,
      )
    },
  )

  it("handles invalid JSON without exposing parser internals", async () => {
    fetchMock.mockResolvedValue(
      new Response("<!DOCTYPE html>", {
        headers: { "Content-Type": "application/json" },
      }),
    )
    await expect(
      requestAutomation("/api/automations", {}, "Automation was not created."),
    ).rejects.toThrow("unexpected response")
  })

  it.each([null, [], "invalid"])(
    "rejects an invalid response envelope: %j",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload))
      await expect(
        requestAutomation(
          "/api/automations",
          {},
          "Automation was not created.",
        ),
      ).rejects.toThrow("unexpected response")
    },
  )

  it("preserves validation details", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: "Validation failed",
          details: ["Choose one target language."],
        },
        { status: 400 },
      ),
    )
    await expect(
      requestAutomation("/api/automations", {}, "Automation was not created."),
    ).rejects.toThrow("Choose one target language.")
  })

  it("preserves backend errors when details are not a string array", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "Automations unavailable", details: { fieldErrors: {} } },
        { status: 503 },
      ),
    )
    await expect(
      requestAutomation("/api/automations", {}, "Automation was not created."),
    ).rejects.toThrow("Automations unavailable")
  })

  it("returns the created automation on success", async () => {
    const payload = { automation: { documentId: "automation-1" } }
    fetchMock.mockResolvedValue(Response.json(payload, { status: 201 }))
    await expect(
      requestAutomation(
        "/api/automations",
        { method: "POST" },
        "Automation was not created.",
      ),
    ).resolves.toEqual(payload)
  })
})
