import { validateSeoUrl } from "./seo-http"
import type { WatchRouteProbe } from "./admin-watch-route-alert-client"

export async function probeWatchRoute(input: {
  origin: string
  path: string
  timeoutMs: number
  fetchImpl?: typeof fetch
  resolveHost?: Parameters<typeof validateSeoUrl>[1]["resolveHost"]
  now?: () => Date
}): Promise<WatchRouteProbe> {
  const probedAt = (input.now ?? (() => new Date()))().toISOString()
  const target = new URL(input.path, `${input.origin}/`)
  const safe = await validateSeoUrl(target, {
    allowedHosts: [new URL(input.origin).hostname],
    resolveHost: input.resolveHost,
  })
  if (!safe.ok || safe.url.origin !== input.origin) {
    return {
      kind: "inconclusive",
      status: null,
      probedAt,
      finalUrl: null,
      contentType: null,
    }
  }
  try {
    const response = await (input.fetchImpl ?? fetch)(safe.url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "forge-mastra-watch-route-monitor/1.0",
      },
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    await response.body?.cancel().catch(() => undefined)
    const contentType =
      response.headers.get("content-type")?.slice(0, 191) ?? null
    const common = {
      status: response.status,
      probedAt,
      finalUrl: safe.url.toString(),
      contentType,
    }
    if (response.status === 404 || response.status === 410) {
      return { kind: "missing", ...common }
    }
    if (response.status >= 300 && response.status < 400) {
      return { kind: "redirect", ...common }
    }
    if (
      response.status >= 200 &&
      response.status < 300 &&
      contentType?.toLowerCase().startsWith("text/html")
    ) {
      return { kind: "healthy_html", ...common }
    }
    return { kind: "inconclusive", ...common }
  } catch {
    return {
      kind: "inconclusive",
      status: null,
      probedAt,
      finalUrl: safe.url.toString(),
      contentType: null,
    }
  }
}
