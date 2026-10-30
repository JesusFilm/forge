import { NextRequest } from "next/server"
import { afterEach, expect, it, vi } from "vitest"

import { proxy } from "./proxy"

afterEach(() => vi.unstubAllEnvs())
const request = (pathname: string, method = "GET") =>
  new NextRequest(`http://192.168.1.25:3210${pathname}`, { method })

it.each(["production", "test"])(
  "returns HTTP 404 before streaming for local pages and APIs in %s with both flags true",
  (environment) => {
    vi.stubEnv("NODE_ENV", environment)
    vi.stubEnv("FEEDBACK_LOCAL_ENABLED", "true")
    vi.stubEnv("FEEDBACK_LOCAL_LINEAR_ENABLED", "true")
    for (const pathname of [
      "/tv/local",
      "/tv/local/",
      "/tv/local/nested",
      "/api/feedback/local",
      "/api/feedback/local/session",
      "/api/feedback/local/linear",
    ]) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const response = proxy(request(pathname, method))
        expect(response.status).toBe(404)
        expect(response.headers.get("x-middleware-next")).toBeNull()
      }
    }
  },
)

it.each([undefined, "false", "TRUE"])(
  "requires the explicit local flag in development: %s",
  (flag) => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("FEEDBACK_LOCAL_ENABLED", flag)
    expect(proxy(request("/tv/local")).status).toBe(404)
    expect(proxy(request("/api/feedback/local/session", "POST")).status).toBe(
      404,
    )
  },
)

it("admits explicitly enabled local development routes for their own origin/session guards", () => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("FEEDBACK_LOCAL_ENABLED", "true")
  for (const pathname of ["/tv/local", "/api/feedback/local/session"]) {
    expect(proxy(request(pathname)).headers.get("x-middleware-next")).toBe("1")
  }
})

it("preserves preview gating independently of the local receiver flag", () => {
  vi.stubEnv("FEEDBACK_LOCAL_ENABLED", "false")
  vi.stubEnv("NODE_ENV", "development")
  expect(
    proxy(request("/tv/preview/frame")).headers.get("x-middleware-next"),
  ).toBe("1")
  vi.stubEnv("NODE_ENV", "production")
  expect(proxy(request("/tv/preview/frame")).status).toBe(404)
})

it("does not gate production feedback or similarly named routes", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("FEEDBACK_LOCAL_ENABLED", "false")
  for (const pathname of [
    "/tv",
    "/tv/advanced",
    "/api/feedback/session",
    "/tv/locality",
    "/api/feedback/locality",
  ]) {
    expect(proxy(request(pathname)).headers.get("x-middleware-next")).toBe("1")
  }
})
