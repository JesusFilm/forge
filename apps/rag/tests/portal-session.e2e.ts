import { test, expect } from "@playwright/test"
import { login } from "./portal-ui.helpers.js"

test("first visit waits for sign-in and expiry restores every section and Usage range", async ({
  page,
}) => {
  await page.goto("/portal")
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/portal$/)
  await login(page, "local-owner")

  let expireNextIdentity = false
  await page.route("**/portal/identity", async (route) => {
    if (expireNextIdentity) {
      expireNextIdentity = false
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"session_expired"}',
      })
    }
    return route.continue()
  })

  for (const name of ["Usage", "Sources", "RAG", "Knowledge", "Consumers"]) {
    await page.getByRole("button", { name, exact: true }).click()
    if (name === "Usage") {
      await page.getByLabel("From (UTC)").fill("2026-09-20T00:00")
      await page.getByLabel("To (UTC, exclusive)").fill("2026-09-21T00:00")
      await page.getByRole("button", { name: "Update reports" }).click()
    }
    expireNextIdentity = true
    await page.reload()
    await expect(
      page.getByRole("heading", { name: "Local development sign-in" }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Continue as local-owner" }).click()
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-current", "page")
    if (name === "Usage") {
      await expect(page.getByLabel("From (UTC)")).toHaveValue(
        "2026-09-20T00:00",
      )
      await expect(page.getByLabel("To (UTC, exclusive)")).toHaveValue(
        "2026-09-21T00:00",
      )
    }
  }
})

test("explicit sign-out remains signed out across open tabs", async ({
  page,
  context,
}) => {
  await login(page, "local-owner")
  const other = await context.newPage()
  await other.goto("/portal")
  await expect(other.getByRole("button", { name: "Sign out" })).toBeVisible()
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(
    other.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible()
  await other.reload()
  await expect(
    other.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible()
  await expect(other).toHaveURL(/\/portal$/)
})

test("visible input coalesces renewal while passive and hidden documents stay idle", async ({
  page,
}) => {
  await login(page, "local-owner")
  let renewals = 0
  await page.route("**/portal/session/renew", async (route) => {
    renewals++
    return route.continue()
  })
  await page.waitForTimeout(200)
  expect(renewals).toBe(0)
  await page.evaluate(() => {
    const future = Date.now() + 16 * 60000
    Date.now = () => future
  })
  await page.getByRole("heading", { name: "Consumers" }).click()
  await page.keyboard.press("ArrowDown")
  await page.mouse.wheel(0, 250)
  await expect.poll(() => renewals).toBe(1)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    const future = Date.now() + 16 * 60000
    Date.now = () => future
    window.dispatchEvent(new Event("pointerdown"))
  })
  await page.waitForTimeout(100)
  expect(renewals).toBe(1)
})

test("an expired protected read starts recovery without a sign-in click", async ({
  page,
}) => {
  await login(page, "local-owner")
  let denyRead = true
  let denyProbe = false
  await page.route("**/portal/consumers", (route) => {
    if (denyRead && route.request().method() === "GET") {
      denyRead = false
      denyProbe = true
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"unauthorized"}',
      })
    }
    return route.continue()
  })
  await page.route("**/portal/identity", (route) => {
    if (denyProbe) {
      denyProbe = false
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"session_expired"}',
      })
    }
    return route.continue()
  })
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Local development sign-in" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue as local-owner" }).click()
  await expect(
    page.getByRole("button", { name: "Create consumer" }),
  ).toBeVisible()
})

test("expiry waits for an in-flight mutation and one-time key without replay", async ({
  page,
}) => {
  const name = "session-recovery-" + Date.now().toString(36)
  let releaseResponse!: () => void
  let mutationArrived!: () => void
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  const sawMutation = new Promise<void>((resolve) => {
    mutationArrived = resolve
  })
  let mutationCount = 0
  await page.route("**/portal/consumers", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    mutationCount++
    const response = await route.fetch()
    const body = await response.json()
    if (typeof body.secret === "string") body.secret = "rag_synthetic-key"
    mutationArrived()
    await responseGate
    return route.fulfill({ response, json: body })
  })
  await login(page, "local-owner")
  await page.getByRole("button", { name: "Create consumer" }).click()
  await page.getByRole("dialog").getByLabel("Consumer name").fill(name)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click()
  await sawMutation
  let failedIdentity = false
  await page.route("**/portal/identity", (route) => {
    if (!failedIdentity) {
      failedIdentity = true
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"session_expired"}',
      })
    }
    return route.continue()
  })
  await page.evaluate(() => {
    const future = Date.now() + 9 * 3600000
    Date.now = () => future
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page).toHaveURL(/\/portal$/)
  releaseResponse()
  await expect(page.getByLabel("One-time API key")).toBeVisible()
  expect(mutationCount).toBe(1)
  expect(
    await page.evaluate(() => JSON.stringify(sessionStorage)),
  ).not.toContain("rag_synthetic-key")
  await page.getByRole("button", { name: "I’ve saved the key" }).click()
  await expect(
    page.getByRole("heading", { name: "Local development sign-in" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue as local-owner" }).click()
  await expect(page.getByRole("rowheader", { name })).toBeVisible()
  expect(mutationCount).toBe(1)
})

test("failed recovery and changed admission offer a manual fallback", async ({
  page,
}) => {
  await login(page, "local-owner")
  let status = 401
  await page.route("**/portal/identity", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          status === 401
            ? "session_expired"
            : status === 403
              ? "admission_denied"
              : "admission_unavailable",
      }),
    }),
  )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Local development sign-in" }),
  ).toBeVisible()
  await page.goto("/portal?recovery=oauth_invalid")
  await expect(
    page.getByText("The session could not be restored.", { exact: false }),
  ).toBeVisible()
  await expect(page).toHaveURL(/recovery=oauth_invalid/)
  status = 403
  await page.goto("/portal")
  await expect(
    page.getByText("Portal access has changed.", { exact: false }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/portal$/)
  status = 503
  await page.reload()
  await expect(
    page.getByText("The portal is unavailable.", { exact: false }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/portal$/)
})
