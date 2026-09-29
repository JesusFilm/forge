import { test, expect } from "@playwright/test"
import { login } from "./portal-ui.helpers.js"

test("registry search, filters, sorting, pages and placeholder navigation", async ({
  page,
}) => {
  // Directory-only visual fixture; mutations remain covered by the real DB journey above.
  await page.route("**/portal/consumers", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await route.fulfill({
      json: {
        consumers: Array.from({ length: 25 }, (_, index) => ({
          consumerId: "registry-" + index,
          name: "registry-" + String(index).padStart(2, "0"),
          state:
            index === 24 ? "revoked" : index === 23 ? "suspended" : "active",
          memberCount: index === 0 ? 1 : 2,
          owned: true,
          credentialVersion: 1,
          membershipVersion: 1,
          lifecycleVersion: 1,
        })),
      },
    })
  })
  await login(page, "local-owner")
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0)
  await expect(page.locator("#result-count")).toHaveText(
    "Showing 20 of 25 consumers",
  )
  await expect(
    page.getByRole("row").filter({ hasText: "registry-00" }),
  ).toContainText("1 member")
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.locator("#result-count")).toHaveText(
    "Showing 5 of 25 consumers",
  )
  await page.getByRole("button", { name: "Revoked", exact: true }).click()
  await expect(page.locator("#result-count")).toHaveText(
    "Showing 1 of 1 consumers",
  )
  await expect(page.locator("#rows")).toContainText("registry-24")
  await page.route("**/portal/consumers/registry-24/recover", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        secret: "rag_synthetic-recovery",
        credentialVersion: 2,
      }),
    }),
  )
  await page.getByRole("button", { name: "Actions for registry-24" }).click()
  await page
    .locator("#row-menu")
    .getByRole("button", { name: "Recover" })
    .click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recover and issue key" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Save your API key" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "I’ve saved the key" }).click()
  await expect(page.getByLabel("One-time API key")).toHaveCount(0)
  await page.getByRole("button", { name: "Suspended", exact: true }).click()
  await expect(page.locator("#rows")).toContainText("registry-23")
  await page.getByRole("button", { name: "All", exact: true }).click()
  await page.getByRole("button", { name: "Name" }).click()
  await expect(page.locator("#rows tr").first()).toContainText("registry-24")
  await page
    .getByRole("searchbox", { name: "Search consumers" })
    .fill("registry-00")
  await expect(page.locator("#rows tr")).toHaveCount(1)
  await page.getByRole("button", { name: "Actions for registry-00" }).click()
  await expect(
    page
      .locator("#row-menu")
      .getByRole("button", { name: "Members", exact: true }),
  ).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(
    page.locator("#row-menu").getByRole("button", { name: "Generate new key" }),
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator("#row-menu")).toBeHidden()
  for (const section of ["RAG", "Knowledge"]) {
    await page.getByRole("button", { name: section, exact: true }).click()
    await expect(
      page.getByRole("heading", { name: section, exact: true }),
    ).toBeVisible()
    const image = page.getByRole("img", { name: /capybara/ })
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true)
    await expect(page.locator("#directory")).toBeHidden()
  }
  await page.getByRole("button", { name: "Consumers", exact: true }).click()
  await expect(
    page.getByRole("searchbox", { name: "Search consumers" }),
  ).toHaveValue("registry-00")
})
