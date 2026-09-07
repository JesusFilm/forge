import { expect, it, vi } from "vitest"
import { StudioPlaybackGateway } from "./playback"
const playlist = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="subtitles.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=100000
variant.m3u8
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:1,
segment.ts
`
function fixture() {
  let published = true
  const authorize = vi.fn(async () =>
    published ? { playbackId: "signed-playback" } : null,
  )
  const fetcher = vi.fn<typeof fetch>(
    async (input) =>
      new Response(
        String(input).endsWith("segment.ts")
          ? Buffer.from("segment")
          : playlist,
        {
          headers: {
            "content-type": String(input).endsWith("segment.ts")
              ? "video/mp2t"
              : "application/vnd.apple.mpegurl",
          },
        },
      ),
  )
  const gateway = new StudioPlaybackGateway({
    authorize,
    sign: async () => "upstream-secret-token",
    resourceKey: Buffer.alloc(32, 1),
    fetcher,
  })
  return {
    gateway,
    authorize,
    fetcher,
    unpublish: () => {
      published = false
    },
  }
}
it("rewrites all HLS resources without exposing tokens and revokes previously issued URLs", async () => {
  const f = fixture(),
    request = new Request(
      "https://admin.test/api/studio/playback/release/index.m3u8",
    )
  const response = await f.gateway.serve("release", "index.m3u8", request),
    text = await response.text()
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(text).not.toContain("mux.com")
  expect(text).not.toContain("upstream-secret-token")
  const urls = [
    ...text.matchAll(
      /\/api\/studio\/playback\/release\/([A-Za-z0-9_-]+\.media)/g,
    ),
  ].map((match) => match[1])
  expect(urls).toHaveLength(6)
  f.unpublish()
  for (const resource of urls)
    expect((await f.gateway.serve("release", resource, request)).status).toBe(
      404,
    )
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it("rejects cross-release resource binding and hostile redirects without leaking provider errors", async () => {
  const f = fixture(),
    request = new Request("https://admin.test/")
  const text = await (
    await f.gateway.serve("release", "index.m3u8", request)
  ).text()
  const resource = text.match(/release\/([A-Za-z0-9_-]+\.media)/)![1]
  expect(
    (await f.gateway.serve("other-release", resource, request)).status,
  ).toBe(404)
  f.fetcher.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://credentials.example.test/secret" },
    }),
  )
  const response = await f.gateway.serve("release", "index.m3u8", request)
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain("secret")
})
it("rechecks publication after upstream fetch so a concurrent unpublish cannot deliver bytes", async () => {
  const f = fixture()
  f.fetcher.mockImplementation(async () => {
    f.unpublish()
    return new Response(playlist, {
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    })
  })
  const response = await f.gateway.serve(
    "release",
    "index.m3u8",
    new Request("https://admin.test/"),
  )
  expect(response.status).toBe(404)
  expect(await response.text()).not.toContain("EXTM3U")
})
it("forwards valid single segment ranges, rejects malformed/multiple ranges, and serves HEAD without a body", async () => {
  const f = fixture(),
    request = new Request("https://admin.test/")
  const text = await (
    await f.gateway.serve("release", "index.m3u8", request)
  ).text()
  const resource = [...text.matchAll(/release\/([A-Za-z0-9_-]+\.media)/g)].at(
    -1,
  )![1]
  f.fetcher.mockImplementation(async (_input, init) => {
    const range = new Headers(init?.headers).get("range")
    if (init?.method === "HEAD") {
      expect(range).toBeNull()
      return new Response(null, {
        headers: { "content-type": "video/mp2t", "content-length": "7" },
      })
    }
    expect(["bytes=0-1", "bytes=0-", "bytes=-2"]).toContain(range)
    return new Response("ab", {
      status: 206,
      headers: { "content-type": "video/mp2t", "content-range": "bytes 0-1/7" },
    })
  })
  for (const range of ["bytes=0-1", "bytes=0-", "bytes=-2"]) {
    const response = await f.gateway.serve(
      "release",
      resource,
      new Request("https://admin.test/", { headers: { Range: range } }),
    )
    expect(response.status).toBe(206)
    expect(await response.text()).toBe("ab")
  }
  const before = f.fetcher.mock.calls.length
  for (const range of [
    "bytes=0-1,3-4",
    "bytes=-0",
    "bytes=3-1",
    "bytes=9007199254740993-",
  ])
    expect(
      (
        await f.gateway.serve(
          "release",
          resource,
          new Request("https://admin.test/", { headers: { Range: range } }),
        )
      ).status,
    ).toBe(416)
  expect(f.fetcher).toHaveBeenCalledTimes(before)
  const head = await f.gateway.serve(
    "release",
    resource,
    new Request("https://admin.test/", {
      method: "HEAD",
      headers: { Range: "bytes=0-1" },
    }),
  )
  expect(head.status).toBe(200)
  expect(await head.text()).toBe("")
  f.fetcher.mockResolvedValue(new Response(null, { status: 416 }))
  expect(
    (
      await f.gateway.serve(
        "release",
        resource,
        new Request("https://admin.test/", { headers: { Range: "bytes=99-" } }),
      )
    ).status,
  ).toBe(416)
})
it("revokes poster and storyboard image resources and exposes no public download route", async () => {
  const f = fixture(),
    request = new Request("https://admin.test/")
  f.fetcher.mockImplementation(async (input) =>
    String(input).includes("storyboard.vtt")
      ? new Response(
          "WEBVTT\n\n00:00.000 --> 00:01.000\n./storyboard.jpg#xywh=0,0,100,100\n",
          { headers: { "content-type": "text/vtt" } },
        )
      : new Response("image-bytes", {
          headers: { "content-type": "image/webp" },
        }),
  )
  expect(
    (await f.gateway.serve("release", "poster.webp", request)).status,
  ).toBe(200)
  const storyboard = await (
    await f.gateway.serve("release", "storyboard.vtt", request)
  ).text()
  expect(storyboard).toContain("#xywh=0,0,100,100")
  expect(storyboard).not.toContain("mux.com")
  const image = storyboard.match(/release\/([A-Za-z0-9_-]+\.media)/)![1]
  expect((await f.gateway.serve("release", image, request)).status).toBe(200)
  f.unpublish()
  for (const resource of [
    "poster.webp",
    "storyboard.vtt",
    image,
    "download.mp4",
  ])
    expect((await f.gateway.serve("release", resource, request)).status).toBe(
      404,
    )
})
it.each(["initial", "final", "signing"] as const)(
  "bounds hung %s work and restores all request slots without late exposure",
  async (phase) => {
    vi.useFakeTimers()
    const controllers: AbortController[] = []
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController()
      controllers.push(controller)
      setTimeout(() => controller.abort(new Error("deadline")), ms)
      return controller.signal
    })
    try {
      let recover = false
      const pending: Array<() => void> = []
      const calls = new Map<string, number>()
      const gateway = new StudioPlaybackGateway({
        resourceKey: Buffer.alloc(32, 2),
        authorize: async (id) => {
          const count = (calls.get(id) ?? 0) + 1
          calls.set(id, count)
          if (
            !recover &&
            ((phase === "initial" && count === 1) ||
              (phase === "final" && count === 2))
          )
            await new Promise<void>((resolve) => pending.push(resolve))
          return { playbackId: "signed-playback" }
        },
        sign: async () => {
          if (!recover && phase === "signing")
            await new Promise<void>((resolve) => pending.push(resolve))
          return "secret"
        },
        fetcher: async () =>
          new Response(playlist, {
            headers: { "content-type": "application/vnd.apple.mpegurl" },
          }),
      })
      const request = new Request("https://admin.test/")
      const requests = Array.from({ length: 8 }, (_, i) =>
        gateway.serve(`release${i}`, "index.m3u8", request),
      )
      await vi.advanceTimersByTimeAsync(0)
      expect((await gateway.serve("ninth", "index.m3u8", request)).status).toBe(
        503,
      )
      await vi.advanceTimersByTimeAsync(15001)
      const results = await Promise.all(
        requests.map((result) => Promise.race([result, Promise.resolve(null)])),
      )
      expect(results.every((result) => result?.status === 502)).toBe(true)
      recover = true
      expect(
        (await gateway.serve("recovered", "index.m3u8", request)).status,
      ).toBe(200)
      for (const resolve of pending) resolve()
      for (const response of await Promise.all(requests))
        expect(await response.text()).toBe("Playback unavailable")
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  },
)
it("cancels a stalled body within the same lifetime and releases capacity", async () => {
  vi.useFakeTimers()
  try {
    const f = fixture(),
      cancel = vi.fn()
    f.fetcher.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    )
    const pending = f.gateway.serve(
      "release",
      "index.m3u8",
      new Request("https://admin.test/"),
    )
    await vi.advanceTimersByTimeAsync(15001)
    expect((await pending).status).toBe(502)
    expect(cancel).toHaveBeenCalledOnce()
    expect(f.authorize).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
it("propagates caller cancellation during authorization and never fetches a late result", async () => {
  const abort = new AbortController(),
    fetcher = vi.fn<typeof fetch>(),
    signals: AbortSignal[] = []
  let release: () => void = () => {}
  const gateway = new StudioPlaybackGateway({
    resourceKey: Buffer.alloc(32, 3),
    authorize: async (_id, signal) => {
      signals.push(signal)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { playbackId: "signed" }
    },
    sign: async () => "secret",
    fetcher,
  })
  const response = gateway.serve(
    "release",
    "index.m3u8",
    new Request("https://admin.test/", { signal: abort.signal }),
  )
  abort.abort()
  expect((await response).status).toBe(502)
  expect(signals[0].aborted).toBe(true)
  release()
  await Promise.resolve()
  await Promise.resolve()
  expect(fetcher).not.toHaveBeenCalled()
})
