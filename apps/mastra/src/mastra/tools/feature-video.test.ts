import { describe, expect, it } from "vitest"

import {
  executeFeatureVideo,
  featureVideoInputSchema,
  featureVideoTool,
  FEATURE_VIDEO_TOOL_NAME,
} from "./feature-video"

/**
 * `featureVideo` (feat-327, plan D4/P3) — the declaration tool.
 *
 * There is deliberately almost nothing to test in the executor: it is a pure
 * echo, and ALL of the trust lives in `/forge-seeker`'s resolution ladder
 * (`seeker-route.test.ts`), which only attaches a video whose id is present in
 * THIS turn's own projected search results. What matters here is that the
 * INPUT SURFACE stays a bare videoId — the moment it accepts a title, a URL, or
 * free text, the model starts authoring payload and plan D9 is broken.
 */

describe("featureVideo tool", () => {
  it("echoes the declared videoId", () => {
    expect(executeFeatureVideo({ videoId: "abc-123" })).toEqual({
      videoId: "abc-123",
    })
  })

  it("rejects an empty or non-string videoId", () => {
    expect(() => executeFeatureVideo({ videoId: "" })).toThrow()
    expect(() =>
      executeFeatureVideo({ videoId: 42 as unknown as string }),
    ).toThrow()
  })

  it("accepts videoId and NOTHING else — no title, no URL, no free text (plan P3)", () => {
    // The load-bearing assertion of this file. A widened input schema is how
    // the model would get to author display content instead of selecting from
    // what the route projects itself.
    expect(Object.keys(featureVideoInputSchema.shape)).toEqual(["videoId"])
  })

  it("strips any extra field a model sends alongside the declaration", () => {
    const declared = executeFeatureVideo({
      videoId: "abc-123",
      title: "A title the model invented",
      watchUrl: "https://evil.example",
    } as unknown as { videoId: string })
    expect(declared).toStrictEqual({ videoId: "abc-123" })
  })

  it("registers under the tool name the route resolves declarations from", () => {
    // The route matches tool results by this exact string; a rename that
    // touched only one side would silently stop every declaration resolving.
    expect(featureVideoTool.id).toBe(FEATURE_VIDEO_TOOL_NAME)
    expect(FEATURE_VIDEO_TOOL_NAME).toBe("featureVideo")
  })
})
