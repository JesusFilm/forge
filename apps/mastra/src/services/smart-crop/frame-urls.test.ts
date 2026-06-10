import { describe, expect, it } from "vitest"

import {
  DEFAULT_FRAME_URL_ALLOWED_HOSTS,
  SmartCropFrameUrlError,
  assertAllowedFrameUrl,
  parseAllowedFrameHosts,
} from "./frame-urls"

describe("smart crop frame URL allowlist", () => {
  it("defaults to image.mux.com when no CSV is configured", () => {
    expect(parseAllowedFrameHosts(undefined)).toEqual(["image.mux.com"])
    expect(parseAllowedFrameHosts("")).toEqual(["image.mux.com"])
    expect(DEFAULT_FRAME_URL_ALLOWED_HOSTS).toEqual(["image.mux.com"])
  })

  it("parses, trims, and lowercases the CSV allowlist", () => {
    expect(
      parseAllowedFrameHosts(" image.mux.com , Artifacts.Example.COM ,, "),
    ).toEqual(["image.mux.com", "artifacts.example.com"])
  })

  it("accepts https URLs whose hostname exactly matches the allowlist", () => {
    expect(() =>
      assertAllowedFrameUrl(
        "https://image.mux.com/pb_abc/thumbnail.jpg?time=6",
        ["image.mux.com"],
      ),
    ).not.toThrow()
  })

  it("rejects non-https URLs with frame_host_not_allowed", () => {
    try {
      assertAllowedFrameUrl("http://image.mux.com/frame.jpg", ["image.mux.com"])
      expect.unreachable("expected http URL to be rejected")
    } catch (error) {
      expect(error).toBeInstanceOf(SmartCropFrameUrlError)
      expect((error as SmartCropFrameUrlError).reason).toBe(
        "frame_host_not_allowed",
      )
      expect((error as SmartCropFrameUrlError).retryable).toBe(false)
    }
  })

  it("rejects hostnames outside the allowlist, including subdomains", () => {
    expect(() =>
      assertAllowedFrameUrl("https://evil.example.com/frame.jpg", [
        "image.mux.com",
      ]),
    ).toThrow(SmartCropFrameUrlError)
    expect(() =>
      assertAllowedFrameUrl("https://sub.image.mux.com/frame.jpg", [
        "image.mux.com",
      ]),
    ).toThrow(SmartCropFrameUrlError)
  })

  it("rejects unparseable URLs", () => {
    expect(() => assertAllowedFrameUrl("not a url", ["image.mux.com"])).toThrow(
      SmartCropFrameUrlError,
    )
  })
})
