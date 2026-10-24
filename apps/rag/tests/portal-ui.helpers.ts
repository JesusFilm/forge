import { expect, type Page } from "@playwright/test"

export const login = async (page: Page, user: string) => {
  await page.goto("/portal")
  await page.getByRole("link", { name: "Continue with GitHub" }).click()
  await page.getByRole("button", { name: "Continue as " + user }).click()
  await expect(
    page.getByRole("button", { name: "Create consumer", exact: true }),
  ).toBeVisible()
}
