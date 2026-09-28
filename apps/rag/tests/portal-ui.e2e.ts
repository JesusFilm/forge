import { mkdir, writeFile } from "node:fs/promises"
import { test, expect, type Page } from "@playwright/test"

const name = "ui-consumer-" + Date.now().toString(36)
const login = async (page: Page, user: string) => {
  await page.goto("/portal")
  await page.getByRole("link", { name: "Continue with GitHub" }).click()
  await page.getByRole("button", { name: "Continue as " + user }).click()
  await expect(
    page.getByRole("button", { name: "Create consumer", exact: true }),
  ).toBeVisible()
}
const consumerRow = (page: Page) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name, exact: true }) })
const dialog = (page: Page) => page.getByRole("dialog")
const signOut = (page: Page) =>
  page.getByRole("button", { name: "Sign out", exact: true }).click()
const key = async (page: Page) => {
  await expect(
    page.getByRole("heading", { name: "Save your API key" }),
  ).toBeVisible()
  // Read only in memory; never include the value in an assertion or artifact.
  return (await page.getByLabel("One-time API key").textContent())!
}
const save = async (page: Page) => {
  await page.getByRole("button", { name: "I’ve saved the key" }).click()
  await expect(page.getByLabel("One-time API key")).toHaveCount(0)
}

test("UI onboarding, membership, key replacement and lifecycle on real PostgreSQL", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000)
  // Keep generated backend credentials only in memory. Render synthetic fixtures
  // so even Playwright's failure-context DOM capture cannot contain a credential.
  const issuedKeys = new Map<string, string>()
  await page.route("**/portal/consumers{,/**}", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    if (typeof body.secret === "string") {
      const fixture = "rag_synthetic-key-" + issuedKeys.size
      issuedKeys.set(fixture, body.secret)
      body.secret = fixture
    }
    await route.fulfill({ response, json: body })
  })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.name))
  await login(page, "local-owner")
  await page
    .getByRole("button", { name: "Create consumer", exact: true })
    .click()
  await dialog(page).getByLabel("Consumer name").fill(name)
  await expect(dialog(page).getByLabel("Initial owner")).toHaveValue(
    "local-owner",
  )
  await expect(dialog(page).getByLabel("Initial owner")).toHaveAttribute(
    "readonly",
    "",
  )
  await expect(
    dialog(page).getByRole("button", { name: "Preview" }),
  ).toHaveCount(0)
  await expect(consumerRow(page)).toHaveCount(0)
  await dialog(page).getByLabel("Consumer name").fill("Invalid Name")
  await dialog(page)
    .getByRole("button", { name: "Create", exact: true })
    .click()
  await expect(dialog(page)).toBeVisible()
  await expect(consumerRow(page)).toHaveCount(0)
  await dialog(page).getByLabel("Consumer name").fill(name)
  await dialog(page).getByLabel("Consumer name").press("Enter")
  const first = await key(page)
  expect(first.startsWith("rag_")).toBe(true)
  await save(page)
  await expect(
    consumerRow(page).getByRole("button", { name: "Members", exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(consumerRow(page)).toBeVisible()
  await expect(page.getByLabel("One-time API key")).toHaveCount(0)
  const searchStatus = async (secret: string) => {
    const response = await page.request.post("/v1/search", {
      headers: { Authorization: "Bearer " + issuedKeys.get(secret) },
      data: { query: "synthetic-query" },
    })
    return response.status()
  }
  expect(await searchStatus(first)).toBe(200)

  await consumerRow(page)
    .getByRole("button", { name: "Members", exact: true })
    .click()
  await expect(
    dialog(page).getByRole("button", { name: "Remove" }),
  ).toBeDisabled()
  await dialog(page)
    .getByLabel("Add member")
    .selectOption({ label: "@local-member" })
  await dialog(page)
    .getByRole("button", { name: "Add member", exact: true })
    .click()
  await expect(dialog(page)).not.toBeVisible()
  await signOut(page)
  await login(page, "local-other")
  await expect(consumerRow(page)).toBeVisible()
  await expect(consumerRow(page).getByRole("button")).toHaveCount(0)
  await signOut(page)
  await login(page, "local-member")
  await expect(
    consumerRow(page).getByRole("button", { name: "Members", exact: true }),
  ).toBeVisible()
  await consumerRow(page)
    .getByRole("button", { name: "Generate new key", exact: true })
    .click()
  await dialog(page)
    .getByRole("button", { name: "Generate new key", exact: true })
    .click()
  const second = await key(page)
  expect(first !== second).toBe(true)
  await save(page)
  expect(await searchStatus(first)).toBe(401)
  expect(await searchStatus(second)).toBe(200)

  await consumerRow(page)
    .getByRole("button", { name: "Members", exact: true })
    .click()
  const ownerRow = dialog(page)
    .locator(".member")
    .filter({ hasText: "@local-owner" })
  await ownerRow.getByRole("button", { name: "Remove" }).click()
  await dialog(page)
    .getByRole("button", { name: "Remove member", exact: true })
    .click()
  await expect(dialog(page)).not.toBeVisible()
  await consumerRow(page)
    .getByRole("button", { name: "Suspend", exact: true })
    .click()
  await dialog(page)
    .getByRole("button", { name: "Suspend", exact: true })
    .click()
  await expect(consumerRow(page)).toContainText("suspended")
  expect(await searchStatus(second)).toBe(401)
  await consumerRow(page)
    .getByRole("button", { name: "Resume", exact: true })
    .click()
  await dialog(page)
    .getByRole("button", { name: "Resume", exact: true })
    .click()
  await expect(consumerRow(page)).toContainText("active")
  expect(await searchStatus(second)).toBe(200)

  // Measure authenticated cold navigation; screenshots are taken only after dismissal.
  await page.goto("/portal")
  await expect(consumerRow(page)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check("16px Apercu"))).toBe(
    true,
  )
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming
    const resources = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[]
    return {
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
      documentBytes: nav.decodedBodySize,
      resources: resources.map((r) => ({
        path: new URL(r.name).pathname,
        bytes: r.decodedBodySize,
        durationMs: Math.round(r.duration),
      })),
    }
  })
  expect(metrics.resources.every((r) => r.path.startsWith("/portal/"))).toBe(
    true,
  )
  expect(
    metrics.documentBytes +
      metrics.resources.reduce((total, r) => total + r.bytes, 0),
  ).toBeLessThan(140_000)
  await mkdir("output/portal", { recursive: true })
  await writeFile(
    "output/portal/load.json",
    JSON.stringify(metrics, null, 2) + "\n",
  )
  await expect(page.getByLabel("One-time API key")).toHaveCount(0)
  await page.screenshot({
    path: "output/portal/consumers-desktop.png",
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: "output/portal/consumers-mobile.png",
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 900 })

  await signOut(page)
  await login(page, "local-owner")
  await expect(consumerRow(page).getByRole("button")).toHaveCount(0)
  await signOut(page)
  await login(page, "local-member")
  await consumerRow(page)
    .getByRole("button", { name: "Revoke", exact: true })
    .click()
  await dialog(page)
    .getByRole("button", { name: "Revoke consumer", exact: true })
    .click()
  await expect(consumerRow(page)).toContainText("revoked")
  expect(await searchStatus(second)).toBe(401)
  await expect(
    consumerRow(page).getByRole("button", { name: "Generate new key" }),
  ).toHaveCount(0)
  expect(errors).toEqual([])

  // A lost issuance response must not cause another creation POST.
  const loss = "ui-loss-" + Date.now().toString(36)
  let posts = 0
  await page.route("**/portal/consumers", async (route) => {
    if (route.request().method() === "POST") {
      posts++
      await route.fetch()
      await route.abort()
    } else await route.continue()
  })
  await page
    .getByRole("button", { name: "Create consumer", exact: true })
    .click()
  await dialog(page).getByLabel("Consumer name").fill(loss)
  await dialog(page)
    .getByRole("button", { name: "Create", exact: true })
    .click()
  await expect(page.getByRole("status")).toContainText(
    "response cannot be recovered",
  )
  expect(posts).toBe(1)
  await expect(page.getByRole("row").filter({ hasText: loss })).toBeVisible()
  await page.unroute("**/portal/consumers")

  // Check a second independently signed-in context for authorization separation.
  const other = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: "https://localhost:3445",
  })
  const otherPage = await other.newPage()
  await login(otherPage, "local-other")
  await expect(
    otherPage.getByRole("row").filter({ hasText: loss }).getByRole("button"),
  ).toHaveCount(0)
  await other.close()
})
