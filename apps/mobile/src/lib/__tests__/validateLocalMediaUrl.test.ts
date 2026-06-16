import { validateLocalMediaUrl } from "../validateLocalMediaUrl"

// The offline download root, as expo-file-system would report it
// (documentDirectory is a file:// URI ending in a slash).
const ROOT =
  "file:///var/mobile/Containers/Data/Application/ABC/Documents/downloads/"
// A plain (non-URI) root form must work too — callers may pass either.
const PLAIN_ROOT =
  "/var/mobile/Containers/Data/Application/ABC/Documents/downloads/"

describe("validateLocalMediaUrl", () => {
  describe("accepts local files under the allowed root", () => {
    it("accepts a file:// URI directly under the root", () => {
      expect(
        validateLocalMediaUrl(`${ROOT}the-birth-of-jesus/rendition.mp4`, ROOT),
      ).toBe(true)
    })

    it("accepts a nested file under the root", () => {
      expect(
        validateLocalMediaUrl(`${ROOT}the-birth-of-jesus/subs/en.vtt`, ROOT),
      ).toBe(true)
    })

    it("accepts a plain-path root form", () => {
      expect(validateLocalMediaUrl(`${ROOT}clip.mp4`, PLAIN_ROOT)).toBe(true)
    })

    it("accepts an in-bounds path that contains a harmless dot segment", () => {
      expect(validateLocalMediaUrl(`${ROOT}a/b/../clip.mp4`, ROOT)).toBe(true)
    })
  })

  describe("rejects path traversal", () => {
    it("rejects literal .. that escapes the root", () => {
      expect(validateLocalMediaUrl(`${ROOT}../../etc/passwd`, ROOT)).toBe(false)
    })

    it("rejects percent-encoded .. traversal", () => {
      expect(
        validateLocalMediaUrl(`${ROOT}%2e%2e/%2e%2e/etc/passwd`, ROOT),
      ).toBe(false)
    })

    it("rejects a sibling directory that shares the root prefix", () => {
      expect(
        validateLocalMediaUrl(
          "file:///var/mobile/Containers/Data/Application/ABC/Documents/downloads-evil/x.mp4",
          ROOT,
        ),
      ).toBe(false)
    })

    it("rejects a null byte in the path", () => {
      expect(validateLocalMediaUrl(`${ROOT}clip%00.mp4`, ROOT)).toBe(false)
    })
  })

  describe("rejects non-local or dangerous schemes", () => {
    it("rejects https", () => {
      expect(validateLocalMediaUrl("https://stream.mux.com/x.m3u8", ROOT)).toBe(
        false,
      )
    })

    it("rejects content://", () => {
      expect(
        validateLocalMediaUrl("content://media/external/video/1", ROOT),
      ).toBe(false)
    })

    it("rejects javascript:", () => {
      expect(validateLocalMediaUrl("javascript:alert(1)", ROOT)).toBe(false)
    })

    it("rejects a file URI with a non-empty host (UNC-style)", () => {
      expect(
        validateLocalMediaUrl(
          "file://evil/var/mobile/Containers/Data/Application/ABC/Documents/downloads/x.mp4",
          ROOT,
        ),
      ).toBe(false)
    })
  })

  describe("rejects empty and malformed input", () => {
    it.each([null, undefined, ""])("rejects %p", (v) => {
      expect(validateLocalMediaUrl(v, ROOT)).toBe(false)
    })

    it("rejects a malformed URI", () => {
      expect(validateLocalMediaUrl("not a uri", ROOT)).toBe(false)
    })

    it("rejects when the allowed root is empty", () => {
      expect(validateLocalMediaUrl(`${ROOT}clip.mp4`, "")).toBe(false)
    })
  })
})
