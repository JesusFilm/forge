import { chromium, type Browser, type Route } from "playwright"
import { setTimeout as sleep } from "node:timers/promises"
import type { BrowserConfig } from "./config.js"
import type { Observation } from "./state.js"

type GaEvent = { name: string; measurementId: string; pathname: string }
type Delivery = GaEvent & { status: number }
export type ProbeResult = Observation & { deliveries: Delivery[] }

export function isGaCollect(raw: string): boolean {
  const url = new URL(raw)
  return (
    url.protocol === "https:" &&
    url.pathname === "/g/collect" &&
    (url.hostname === "analytics.google.com" ||
      url.hostname.endsWith(".analytics.google.com") ||
      url.hostname === "google-analytics.com" ||
      url.hostname.endsWith(".google-analytics.com"))
  )
}

// Inspect the application's ORIGINAL events. Only the event names sent by this
// browser are namespaced, so successful probes cannot satisfy real page_view
// intake queries or inflate page-view/Share counts. Never inject gtag/events.
export function namespaceProbeEvents(
  rawUrl: string,
  rawBody: string | null,
): { url: string; body: string | null; events: GaEvent[] } {
  const url = new URL(rawUrl)
  const events: GaEvent[] = []
  const lines = rawBody?.split("\n") ?? [""]
  for (const line of lines) {
    const combined = new URLSearchParams(url.search)
    for (const [key, value] of new URLSearchParams(line))
      combined.set(key, value)
    const name = combined.get("en")
    if (!name) continue
    let pathname = ""
    try {
      pathname = new URL(combined.get("dl") ?? "").pathname
    } catch {
      /* No valid page identity. */
    }
    events.push({ name, measurementId: combined.get("tid") ?? "", pathname })
  }
  const namespace = (params: URLSearchParams) => {
    const name = params.get("en")
    if (name) params.set("en", `forge_monitor_${name.slice(0, 26)}`)
  }
  namespace(url.searchParams)
  const body =
    rawBody === null
      ? null
      : lines
          .map((line) => {
            const params = new URLSearchParams(line)
            namespace(params)
            return params.toString()
          })
          .join("\n")
  return { url: url.href, body, events }
}

export async function forwardProbe(
  route: Route,
  deliveries: Delivery[],
  fetchResponse: Route["fetch"] = route.fetch.bind(route),
): Promise<void> {
  const rewritten = namespaceProbeEvents(
    route.request().url(),
    route.request().postData(),
  )
  try {
    const response = await fetchResponse({
      url: rewritten.url,
      ...(rewritten.body === null ? {} : { postData: rewritten.body }),
      timeout: 15_000,
      maxRedirects: 0,
    })
    deliveries.push(
      ...rewritten.events.map((event) => ({
        ...event,
        status: response.status(),
      })),
    )
    await route.fulfill({ response })
  } catch {
    deliveries.push(
      ...rewritten.events.map((event) => ({ ...event, status: 0 })),
    )
    await route.abort().catch(() => {})
  }
}

async function waitFor(
  predicate: () => boolean,
  timeout: number,
): Promise<boolean> {
  const until = Date.now() + timeout
  while (!predicate() && Date.now() < until) await sleep(200)
  return predicate()
}

export async function probeBrowser(
  config: BrowserConfig,
  launch = () =>
    chromium.launch({
      headless: true,
    }),
  forward: typeof forwardProbe = forwardProbe,
): Promise<ProbeResult> {
  const deliveries: Delivery[] = []
  let browser: Browser | undefined
  let stage = "browser launch"
  try {
    browser = await launch()
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
    })
    await context.route(
      (url) => /browser-intake.*datadog/.test(url.hostname),
      (route) => route.abort(),
    )
    await context.route(
      (url) => isGaCollect(url.href),
      (route) => forward(route, deliveries),
    )
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    stage = "initial page load"
    const response = await page.goto(config.WATCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    if (
      !response?.ok() ||
      new URL(page.url()).pathname !== new URL(config.WATCH_URL).pathname
    ) {
      return {
        status: "unknown",
        detail: "Watch page unavailable or redirected; cannot verify GA.",
        deliveries,
      }
    }
    const accepted = (name: string, pathname: string) =>
      deliveries.some(
        (event) =>
          event.name === name &&
          event.pathname === pathname &&
          event.measurementId === config.GA_MEASUREMENT_ID &&
          event.status >= 200 &&
          event.status < 300,
      )
    const initialPath = new URL(config.WATCH_URL).pathname
    // Establish that the application rendered, rather than a CDN challenge.
    stage = "Watch controls"
    const share = page
      .getByRole("button", { name: "Share", exact: true })
      .first()
    await share.waitFor({ state: "visible", timeout: 30_000 })
    if (!(await waitFor(() => accepted("page_view", initialPath), 20_000))) {
      return {
        status: "bad",
        detail:
          "Watch rendered, but its initial GA page_view was not accepted for the expected measurement ID and page.",
        deliveries,
      }
    }
    stage = "Share interaction"
    await share.click()
    if (!(await waitFor(() => accepted("share_opened", initialPath), 15_000))) {
      return {
        status: "bad",
        detail:
          "Watch Share opened, but its GA share_opened event was not accepted.",
        deliveries,
      }
    }
    await page.keyboard.press("Escape")
    stage = "Watch navigation"
    const link = page.locator(`a[href="${config.WATCH_NEXT_PATH}"]`).first()
    await link.click()
    await page.waitForURL((url) => url.pathname === config.WATCH_NEXT_PATH)
    if (
      !(await waitFor(
        () => accepted("page_view", config.WATCH_NEXT_PATH),
        20_000,
      ))
    ) {
      return {
        status: "bad",
        detail:
          "Watch navigation completed, but the destination GA page_view was not accepted.",
        deliveries,
      }
    }
    return {
      status: "good",
      detail:
        "Initial page view, Share and navigation GA events were accepted for the expected measurement ID and pages.",
      deliveries,
    }
  } catch {
    return {
      status: "unknown",
      detail: `Browser probe could not complete ${stage}; this does not establish an analytics outage.`,
      deliveries,
    }
  } finally {
    await browser?.close().catch(() => {})
  }
}
