import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getProtectedNativeWorkflowRouteBlock,
  getProtectedNativeWorkflowRouteResponse,
  isBlockedDevotionalNativeMutation,
} from "./devotional-native-route-guard"

describe("devotional native workflow route guard", () => {
  it.each([
    "/api/workflows/daily-devotional/start",
    "/api/workflows/video-first-devotional/create-run",
    "/api/workflows/devotional-source/stream",
    "/api/workflows/devotional-approve/resume",
    "/api/workflows/devotional-publish/runs/run-1/cancel",
  ])("blocks native devotional mutations at %s", (pathname) => {
    expect(isBlockedDevotionalNativeMutation("POST", pathname)).toBe(true)
  })

  it("allows read-only inspection and unrelated workflow mutations", () => {
    expect(
      isBlockedDevotionalNativeMutation(
        "GET",
        "/api/workflows/video-first-devotional/runs/run-1",
      ),
    ).toBe(false)
    expect(
      isBlockedDevotionalNativeMutation(
        "POST",
        "/api/workflows/offline-search-eval/start",
      ),
    ).toBe(false)
  })

  it.each(["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"])(
    "blocks %s on every native storefront workflow path",
    (method) => {
      expect(
        getProtectedNativeWorkflowRouteBlock(
          method,
          "/api/workflows/storefront-homepage-curation/runs/run-1",
        ),
      ).toBe("storefront_curator_operator_route_required")
    },
  )

  it("blocks an encoded-slash storefront path without affecting unrelated reads", () => {
    expect(
      getProtectedNativeWorkflowRouteBlock(
        "GET",
        "/api/workflows/storefront-homepage-curation%2Fruns/run-1",
      ),
    ).toBe("storefront_curator_operator_route_required")
    expect(
      getProtectedNativeWorkflowRouteBlock(
        "GET",
        "/api/workflows/offline-search-eval/runs/run-1",
      ),
    ).toBeNull()
  })

  it("does not throw on malformed encoding and still blocks a literal protected id", () => {
    expect(() =>
      getProtectedNativeWorkflowRouteBlock(
        "GET",
        "/api/workflows/storefront-homepage-curation/%E0%A4%A",
      ),
    ).not.toThrow()
    expect(
      getProtectedNativeWorkflowRouteBlock(
        "GET",
        "/api/workflows/storefront-homepage-curation/%E0%A4%A",
      ),
    ).toBe("storefront_curator_operator_route_required")
  })

  it.each([
    ["POST", "/api/workflows/storefront-homepage-curation/start"],
    ["GET", "/api/workflows/storefront-homepage-curation/runs/run-1"],
    ["POST", "/api/workflows/storefront-homepage-curation%2Fruns/run-1/resume"],
  ])("builds the production 403 response for %s %s", (method, pathname) => {
    expect(getProtectedNativeWorkflowRouteResponse(method, pathname)).toEqual({
      status: 403,
      body: {
        error: "storefront_curator_operator_route_required",
        message:
          "Use the authenticated /forge-storefront-curation operator route.",
      },
    })
  })

  it("wires the tested response seam into the production workflow middleware", () => {
    const indexSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8",
    )
    const start = indexSource.indexOf('path: "/api/workflows/*"')
    const end = indexSource.indexOf("await next()", start)
    const middleware = indexSource.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(middleware).toContain("getProtectedNativeWorkflowRouteResponse(")
    expect(middleware).toContain(
      "return c.json(response.body, response.status)",
    )
  })
})
