import { mkdir } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { serve, type ServerType } from "@hono/node-server"
import { Hono } from "hono"
import { expect, test, type Page } from "@playwright/test"
import { fixture } from "../src/serving/http/portal-fixture.test-support.js"
import { createPortal } from "../src/serving/http/portal.js"
import {
  createPortalSourcesReader,
  type PortalSources,
} from "../src/serving/http/portal-sources.js"
import { allSources } from "../src/registry/index.js"

let server: ServerType
let origin: string
let admission: ReturnType<typeof fixture>
let actual: PortalSources

test.beforeAll(async () => {
  admission = fixture()
  admission.sessions.set("synthetic-sources-test", {
    id: 42,
    login: "engineer",
  })
  const reader = createPortalSourcesReader(allSources())
  actual = await reader()
  const app = new Hono().route(
    "/portal",
    createPortal({ ...admission.deps, sources: reader }),
  )
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  )
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
test.beforeEach(() => {
  admission.setAllowed(true)
})
const sources = async (page: Page) => {
  await page.goto(origin + "/portal")
  await expect(page.locator("#account")).toContainText("@engineer")
  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await expect(
    page.getByRole("table", { name: "Production sources" }),
  ).toBeVisible()
}

test("committed production inventory, brand grouping, language selection and domain search", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await sources(page)
  await expect(page.locator("#sources time")).toHaveAttribute(
    "datetime",
    actual.observedAt,
  )
  await expect(page.locator(".sources-summary")).toContainText(
    actual.totals.documents.toLocaleString("en"),
  )
  await expect(
    page.getByRole("table", { name: "Production sources" }).getByRole("row"),
  ).toHaveCount(Math.min(actual.sources.length, 8) + 1)
  await page
    .getByRole("button", {
      name: "EveryStudent Multiple domains",
      exact: false,
    })
    .click()
  await expect(
    page.getByRole("heading", { name: "EveryStudent", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("combobox", { name: "Filter by language" })
    .fill("French (fr)")
  await expect(page.locator(".sources-language[open]")).toContainText("French")
  await expect(page.locator(".sources-language[open]")).toContainText(
    "www.questions2vie.com",
  )
  await expect(
    page.getByRole("searchbox", { name: "Search detected languages" }),
  ).toHaveValue("french (fr)")
  await page.getByRole("combobox", { name: "Filter by language" }).fill("en")
  await expect(page.locator(".sources-language")).toHaveCount(1)
  await expect(page.locator(".sources-language summary")).toContainText(
    "English",
  )
  await page.getByRole("combobox", { name: "Filter by language" }).fill("")
  await page
    .getByRole("searchbox", { name: "Search sources" })
    .fill("pyetjetejetes.com")
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2)
  await page
    .getByRole("searchbox", { name: "Search detected languages" })
    .fill("Dutch")
  await expect(page.locator(".sources-language summary")).toContainText(
    "Outside expected languages",
  )
  await page.locator(".sources-language summary").click()
  await expect(page.locator(".sources-language[open]")).toContainText(
    "www.pyetjetejetes.com",
  )
  await page
    .getByRole("searchbox", { name: "Search sources" })
    .fill("no-such-domain")
  await expect(
    page.getByText("No production sources match these filters."),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "EveryStudent", exact: true }),
  ).toHaveCount(0)
  expect(errors).toEqual([])
})

test("250+ languages and multiple list pages stay bounded and remain searchable", async ({
  page,
}) => {
  const domains = [{ host: "many.example", documents: 265 }]
  const languages = Array.from({ length: 265 }, (_, index) => ({
    code: `q${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    documents: 1,
    domains: [
      {
        ...domains[0],
        documents: 1,
        unexpected: false,
        expectationUnknown: false,
      },
    ],
  }))
  const catalog: PortalSources = {
    observedAt: actual.observedAt,
    totals: { sources: 25, languages: 265, documents: 6625 },
    sources: Array.from({ length: 25 }, (_, index) => ({
      id: `synthetic:${index}`,
      name: `Brand ${String(index).padStart(2, "0")}`,
      documents: 265,
      domains,
      languages,
    })),
  }
  await page.route("**/portal/sources", (route) =>
    route.fulfill({ json: catalog }),
  )
  await sources(page)
  await expect(page.locator(".sources-language")).toHaveCount(8)
  await page.getByRole("button", { name: "Next sources page" }).click()
  await expect(
    page.getByRole("button", { name: "Brand 08 many.example" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Brand 08 many.example" }).click()
  await page.getByRole("button", { name: "Next languages page" }).click()
  await expect(
    page.getByRole("group", { name: "languages pagination" }),
  ).toContainText("2 / 34")
  await page.getByRole("combobox", { name: "Filter by language" }).fill("qke")
  await expect(page.locator(".sources-language")).toHaveCount(1)
  await expect(page.locator(".sources-language[open]")).toContainText(
    "many.example",
  )
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(9)
})

test("snapshot failure can retry, and navigation and expired sessions discard pending data", async ({
  page,
}) => {
  let requests = 0
  await page.route("**/portal/sources", async (route) => {
    if (++requests === 1)
      await route.fulfill({
        status: 503,
        json: { error: "sources_snapshot_unavailable" },
      })
    else await route.continue()
  })
  await page.goto(origin + "/portal")
  await expect(page.locator("#account")).toContainText("@engineer")
  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("snapshot is unavailable")
  await page.getByRole("button", { name: "Retry sources" }).click()
  await expect(
    page.getByRole("table", { name: "Production sources" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Consumers", exact: true }).click()
  await expect(page.locator("#sources")).toBeEmpty()
  admission.setAllowed(false)
  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible()
  await expect(page.locator("#sources")).toBeEmpty()
})

test("desktop/mobile layout and initial load keep Sources assets deferred", async ({
  page,
}) => {
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await page.goto(origin + "/portal")
  await expect(page.locator("#account")).toContainText("@engineer")
  expect(requests.filter((url) => /\/sources(?:\.|$)/.test(url))).toEqual([])
  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await page
    .getByRole("button", { name: "GotQuestions www.gotquestions.org" })
    .click()
  await expect(page.locator(".sources-detail")).toContainText(
    "Unidentified language",
  )
  await mkdir("output/sources", { recursive: true })
  await page.screenshot({ path: "output/sources/desktop.png", fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await expect(
    page.getByRole("link", { name: "www.gotquestions.org" }).last(),
  ).toBeVisible()
  await page.screenshot({ path: "output/sources/mobile.png", fullPage: true })
  expect(requests.every((url) => url.startsWith(origin))).toBe(true)
})

test("late snapshot response cannot repopulate a section after navigation", async ({
  page,
}) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/portal/sources", async (route) => {
    await gate
    await route.fulfill({ json: actual })
  })
  await page.goto(origin + "/portal")
  await expect(page.locator("#account")).toContainText("@engineer")
  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await expect(page.getByText("Loading production sources…")).toBeVisible()
  await page.getByRole("button", { name: "Consumers", exact: true }).click()
  const response = page.waitForResponse("**/portal/sources")
  release()
  await response
  await expect(page.locator("#sources")).toBeEmpty()
  await expect(page.locator("#sources")).toBeHidden()
  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await expect(
    page.getByRole("table", { name: "Production sources" }),
  ).toBeVisible()
})
