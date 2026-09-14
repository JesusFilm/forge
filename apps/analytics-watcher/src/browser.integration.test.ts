import { createServer } from "node:http"
import { afterEach, expect, it } from "vitest"
import { forwardProbe, probeBrowser } from "./browser.js"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

async function fixture(tracking: boolean) {
  const collected: string[] = []
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/collect")) {
      collected.push(
        new URL(req.url, "http://localhost").searchParams.get("en") ?? "",
      )
      res.writeHead(204).end()
      return
    }
    res.setHeader("Content-Type", "text/html")
    res.end(`<!doctype html><html><head><title>Watch fixture</title></head><body>
      <button id="share">Share</button><a href="/watch/next.html">Next</a>
      <script>
        const enabled = ${JSON.stringify(tracking)};
        function event(name) {
          if (!enabled) return;
          const query = new URLSearchParams({tid: 'G-TEST123', en: name, dl: location.href});
          fetch('https://analytics.google.com/g/collect?' + query, {mode: 'no-cors'});
        }
        event('page_view');
        document.getElementById('share').onclick = () => event('share_opened');
        document.querySelector('a').onclick = (e) => { e.preventDefault(); history.pushState({}, '', '/watch/next.html'); event('page_view'); };
      </script></body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("missing fixture port")
  const origin = `http://127.0.0.1:${address.port}`
  const result = await probeBrowser(
    {
      WATCH_URL: `${origin}/watch/jesus.html`,
      WATCH_NEXT_PATH: "/watch/next.html",
      GA_MEASUREMENT_ID: "G-TEST123",
    },
    undefined,
    (route, deliveries) =>
      forwardProbe(route, deliveries, (options) => {
        const original = new URL(options?.url ?? route.request().url())
        return route.fetch({
          ...options,
          url: `${origin}/collect${original.search}`,
        })
      }),
  )
  return { result, collected }
}

it("exercises the actual browser, forwarding and SPA journey without real analytics traffic", async () => {
  const { result, collected } = await fixture(true)
  expect(result.status).toBe("good")
  expect(result.deliveries.map((d) => [d.name, d.pathname, d.status])).toEqual([
    ["page_view", "/watch/jesus.html", 204],
    ["share_opened", "/watch/jesus.html", 204],
    ["page_view", "/watch/next.html", 204],
  ])
  expect(collected).toEqual([
    "forge_monitor_page_view",
    "forge_monitor_share_opened",
    "forge_monitor_page_view",
  ])
}, 30_000)

it("detects a rendered Watch page with tracking removed", async () => {
  const { result, collected } = await fixture(false)
  expect(result.status).toBe("bad")
  expect(result.detail).toContain("initial GA page_view")
  expect(collected).toEqual([])
}, 30_000)
