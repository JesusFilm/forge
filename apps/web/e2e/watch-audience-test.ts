import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test as base, expect, type Response } from "@playwright/test"

// Audience integration previews use loopback Web/Admin/hosted Auth. Never send
// test traffic to telemetry (including Mux Data), or an external write endpoint.
// Optional local media fixtures retain the real player/manifest/segment path.
export const test = base.extend<{ audienceNetworkBoundary: void }>({
  serviceWorkers: "block",
  audienceNetworkBoundary: [
    async ({ context }, use, info) => {
      // Production action IDs come from the actual build, never a guessed hash.
      // Only Watch event telemetry is blocked; auth/publication actions stay real.
      const manifestPaths = [
        join(process.cwd(), ".next/server/server-reference-manifest.json"),
        // Negative tests may target a separately built exact parent. Its action
        // IDs use a different build salt and need the same telemetry fence.
        ...(process.env.WATCH_AUDIENCE_TEST_REFERENCE_MANIFEST
          ? [process.env.WATCH_AUDIENCE_TEST_REFERENCE_MANIFEST]
          : []),
      ]
      const manifests = await Promise.all(
        manifestPaths.map(
          async (path) =>
            JSON.parse(await readFile(path, "utf8")) as {
              node: Record<string, { filename?: string; exportedName?: string }>
            },
        ),
      )
      const telemetryActions = new Set(
        manifests.flatMap((manifest) =>
          Object.entries(manifest.node)
            .filter(
              ([, action]) =>
                action.filename?.endsWith("/watch-event-actions.ts") &&
                action.exportedName?.startsWith("record"),
            )
            .map(([id]) => id),
        ),
      )
      expect(telemetryActions.size).toBeGreaterThan(0)
      const blocked: { host: string; path: string; method: string }[] = []
      const media: { host: string; path: string; method: string }[] = []
      const externalPeers: { host: string; method: string }[] = []
      const responseChecks: Promise<void>[] = []
      const checkResponse = (response: Response) => {
        const host = new URL(response.url()).hostname
        if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return
        responseChecks.push(
          (async () => {
            if (await response.serverAddr())
              externalPeers.push({ host, method: response.request().method() })
          })(),
        )
      }
      context.on("response", checkResponse)
      await context.routeWebSocket("**/*", (socket) => {
        const url = new URL(socket.url())
        if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
          socket.connectToServer()
        } else {
          blocked.push({
            host: url.hostname,
            path: url.pathname,
            method: "WEBSOCKET",
          })
          socket.close()
        }
      })
      await context.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const entry = {
          host: url.hostname,
          path: url.pathname,
          method: request.method(),
        }
        // First-party recommendation measurement also stays inside the test
        // boundary; actual content delivery, auth and publication remain real.
        if (
          telemetryActions.has(request.headers()["next-action"] ?? "") ||
          /\/api\/recommendations\/(?:evidence|select|surface-delivery|surface-exposure|content-actions|playback)$/.test(
            url.pathname,
          ) ||
          /\/api\/internal\/recommendations\/precomputed-measurement$/.test(
            url.pathname,
          )
        ) {
          blocked.push(entry)
          await route.abort("blockedbyclient")
          return
        }
        if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
          await route.continue()
          return
        }
        const fixtures = process.env.WATCH_AUDIENCE_TEST_MEDIA_DIR
        const poster = url.hostname === "image.mux.com"
        const stream = url.hostname === "stream.mux.com"
        if (fixtures && request.method() === "GET" && (poster || stream)) {
          const segment = url.pathname.endsWith(".ts")
          await route.fulfill({
            body: await readFile(
              join(
                fixtures,
                poster
                  ? "hero-fixture.webp"
                  : segment
                    ? "media.ts"
                    : "media.m3u8",
              ),
            ),
            contentType: poster
              ? "image/webp"
              : segment
                ? "video/mp2t"
                : "application/vnd.apple.mpegurl",
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "no-store",
            },
          })
          media.push(entry)
          return
        }
        blocked.push(entry)
        await route.abort("blockedbyclient")
      })
      await use()
      // Stop collecting before context teardown, then drain every inspection.
      // A late synthetic media response must not create an orphaned promise.
      context.off("response", checkResponse)
      await Promise.all(responseChecks)
      await info.attach("audience network boundary", {
        body: JSON.stringify({
          blocked,
          localMedia: media,
          externalPeers,
        }),
        contentType: "application/json",
      })
      expect(media.every((entry) => entry.method === "GET")).toBe(true)
      expect(externalPeers).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
