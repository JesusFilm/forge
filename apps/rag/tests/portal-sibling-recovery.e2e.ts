import { test, expect } from "@playwright/test"
import { login } from "./portal-ui.helpers.js"

test("sibling recovery refreshes an already signed-in tab and a sibling failure stays manual", async ({
  page,
}) => {
  await login(page, "local-owner")
  let identityReads = 0
  await page.route("**/portal/identity", async (route) => {
    identityReads++
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({
      response,
      json: { ...body, managementAvailable: false },
    })
  })
  await page.evaluate(() => {
    const channel = new BroadcastChannel("rag.portal.session")
    channel.postMessage({ type: "restored" })
    channel.close()
  })
  await expect.poll(() => identityReads).toBe(1)
  await expect(
    page.getByText("Consumer management is not enabled yet."),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Create consumer" }),
  ).toBeHidden()
  await page.evaluate(() => {
    const channel = new BroadcastChannel("rag.portal.session")
    channel.postMessage({ type: "recovery-failed" })
    channel.close()
  })
  await expect(
    page.getByText("The session could not be restored.", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/portal$/)
})

test("sibling recovery waits until a one-time key is dismissed", async ({
  page,
}) => {
  await login(page, "local-owner")
  const name = "sibling-key-" + Date.now()
  await page.getByRole("button", { name: "Create consumer" }).click()
  await page.getByRole("dialog").getByLabel("Consumer name").fill(name)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click()
  await expect(page.getByLabel("One-time API key")).toBeVisible()
  let identityReads = 0
  await page.route("**/portal/identity", async (route) => {
    identityReads++
    await route.continue()
  })
  await page.evaluate(() => {
    const channel = new BroadcastChannel("rag.portal.session")
    channel.postMessage({ type: "restored" })
    channel.close()
  })
  await page.waitForTimeout(100)
  await expect(page.getByLabel("One-time API key")).toBeVisible()
  expect(identityReads).toBe(0)
  await page.getByRole("button", { name: "I’ve saved the key" }).click()
  await expect.poll(() => identityReads).toBe(1)

  await page.getByRole("button", { name: "Create consumer" }).click()
  await page
    .getByRole("dialog")
    .getByLabel("Consumer name")
    .fill(name + "-again")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click()
  await expect(page.getByLabel("One-time API key")).toBeVisible()
  await page.evaluate(() => {
    const channel = new BroadcastChannel("rag.portal.session")
    channel.postMessage({ type: "recovery-failed", reason: "admission_denied" })
    channel.close()
  })
  await page.waitForTimeout(100)
  await expect(page.getByLabel("One-time API key")).toBeVisible()
  await page.getByRole("button", { name: "I’ve saved the key" }).click()
  await expect(
    page.getByText("Portal access has changed.", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible()
})
