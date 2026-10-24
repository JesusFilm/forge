import { expect, test, type Page } from "@playwright/test"

// Runs against a real Watch home where the Partner panel mounts
// `WatchPartnerAccount` and `WatchPartnerResources` (assembled in the stage's
// shell PR). Nothing here signs in, creates an account or fabricates a session:
//
// - the forge attempts assert that no URL flag, storage value, cookie or
//   browser event unlocks account tools;
// - the sign-in test stops at the request to the hosted login route, so no
//   credential is entered;
// - the real-session test only runs when the coordinator supplies a session
//   cookie obtained from an actual hosted Auth round trip.
//
// WATCH_PARTNER_TEST_SESSION_COOKIE is that cookie's value (never committed).
const homePath = process.env.WATCH_PARTNER_TEST_PATH ?? "/watch"
const sessionCookie = process.env.WATCH_PARTNER_TEST_SESSION_COOKIE
const SESSION_COOKIE_NAME = "forge_web_session"

async function openPartner(page: Page, path = homePath) {
  await page.goto(path)
  await page
    .getByTestId("watch-next-steps")
    .getByRole("tab", { name: "Partner with us", exact: true })
    .click()
  if (!new URL(path, "http://watch.test").searchParams.has("partnerPanel")) {
    for (let i = 0; i < 3; i += 1)
      await page
        .getByTestId("watch-role-journey")
        .locator("[data-option-id]")
        .first()
        .click()
  }
  await expect(page.getByTestId("watch-partner-account")).toBeVisible()
}

/** The account panel after the server has answered, whatever the answer. */
async function answeredAccount(page: Page) {
  const account = page.getByTestId("watch-partner-account")
  await expect(account).not.toHaveAttribute("data-account-state", "checking")
  return account
}

test.describe("Partner library and account", () => {
  test("shows the public library with real external links and locks account tools when signed out", async ({
    page,
  }) => {
    await openPartner(page)

    const library = page.getByTestId("watch-partner-resources")
    await expect(library).toBeVisible()
    const links = library.locator("a")
    expect(await links.count()).toBeGreaterThan(0)
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute(
        "href",
        /^https:\/\/www\.jesusfilm\.org\//,
      )
      await expect(link).toHaveAttribute("rel", "noopener noreferrer")
      await expect(link).toHaveAttribute("target", "_blank")
    }

    const account = await answeredAccount(page)
    await expect(account).toHaveAttribute("data-account-state", "signed-out")
    await expect(page.getByTestId("watch-partner-sign-in")).toBeVisible()
    await expect(page.getByTestId("watch-partner-account-tools")).toHaveCount(0)
  })

  test("filters the library by category", async ({ page }) => {
    await openPartner(page)
    const library = page.getByTestId("watch-partner-resources")
    const all = await library.locator("[data-resource-id]").count()

    await library.getByRole("button", { name: /^Training/ }).click()

    const training = await library.locator("[data-resource-id]").count()
    expect(training).toBeGreaterThan(0)
    expect(training).toBeLessThan(all)
    await library.getByRole("button", { name: /^All/ }).click()
    await expect(library.locator("[data-resource-id]")).toHaveCount(all)
  })

  test("forged flags, storage, cookies and events do not unlock account tools", async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: "forged-not-a-session",
        domain: new URL(baseURL!).hostname,
        path: "/watch",
      },
    ])
    await page.addInitScript(() => {
      for (const key of [
        "unlocked",
        "forge.watch.account",
        "forge.watch.partner",
        "watch-partner-unlocked",
      ]) {
        localStorage.setItem(key, JSON.stringify({ authenticated: true }))
      }
    })
    await openPartner(
      page,
      `${homePath}?as=partner&partnerPanel=account&unlocked=1`,
    )
    const account = await answeredAccount(page)

    await page.evaluate(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "forge.watch.account" }),
      )
      window.dispatchEvent(new CustomEvent("watch-account-change"))
      window.postMessage({ authenticated: true, accountGateEnabled: true }, "*")
    })
    // A focus event is allowed to trigger a re-read; the server still decides.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await answeredAccount(page)

    await expect(account).not.toHaveAttribute("data-account-state", "signed-in")
    await expect(page.getByTestId("watch-partner-account-tools")).toHaveCount(0)
  })

  test("sign-in goes to the hosted login route and asks to come back to this page", async ({
    page,
  }) => {
    await openPartner(page, `${homePath}?as=partner`)
    await answeredAccount(page)
    const loginRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname.endsWith("/watch/api/auth/login"),
    )
    // Stop before the hosted page: no credential is ever entered here.
    await page.route("**/watch/api/auth/login*", (route) => route.abort())

    await page.getByTestId("watch-partner-sign-in").click()

    const url = new URL((await loginRequest).url())
    expect(url.searchParams.get("returnTo")).toBe(
      `${homePath}?as=partner&partnerPanel=account`,
    )
  })

  test("a sign-in that did not finish keeps the page and role, says so, and stays signed out", async ({
    page,
  }) => {
    await openPartner(page)
    await page.goto(
      `${homePath}?as=partner&partnerPanel=account&auth=failed&reason=callback_failed`,
    )

    await expect(
      page
        .getByTestId("watch-next-steps")
        .getByRole("tab", { name: "Partner with us", exact: true }),
    ).toHaveAttribute("aria-selected", "true")
    const account = await answeredAccount(page)
    await expect(page.getByTestId("watch-partner-auth-notice")).toContainText(
      "didn’t finish",
    )
    await expect(account).toHaveAttribute("data-account-state", "signed-out")
    await expect(page.getByTestId("watch-partner-account-tools")).toHaveCount(0)
  })

  test("390px has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPartner(page)
    await answeredAccount(page)

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe("Partner account with a real session", () => {
  test.skip(
    !sessionCookie,
    "needs WATCH_PARTNER_TEST_SESSION_COOKIE from a real hosted Auth round trip",
  )

  test("unlocks the tools, locks them again when the session ends, and signs out", async ({
    page,
    baseURL,
  }) => {
    const domain = new URL(baseURL!).hostname
    await page.context().addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: sessionCookie!,
        domain,
        path: "/watch",
        httpOnly: true,
      },
    ])
    await openPartner(page, `${homePath}?as=partner`)
    const account = await answeredAccount(page)
    await expect(account).toHaveAttribute("data-account-state", "signed-in")
    await expect(page.getByTestId("watch-partner-account-tools")).toBeVisible()

    // Clearing the real Web cookie models session loss; the event only prompts
    // a fresh server read, and the server no longer recognises the visitor.
    await page.context().clearCookies({ name: SESSION_COOKIE_NAME })
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(account).toHaveAttribute("data-account-state", "signed-out")
    await expect(page.getByTestId("watch-partner-account-tools")).toHaveCount(0)
    await expect(page.getByTestId("watch-partner-resources")).toBeVisible()
  })

  test("signing out through the hosted route returns to the same page signed out", async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: sessionCookie!,
        domain: new URL(baseURL!).hostname,
        path: "/watch",
        httpOnly: true,
      },
    ])
    await openPartner(page, `${homePath}?as=partner`)
    await expect(page.getByTestId("watch-partner-account")).toHaveAttribute(
      "data-account-state",
      "signed-in",
    )

    await page.getByTestId("watch-partner-sign-out").click()

    await expect(page).toHaveURL((url) => url.pathname === homePath)
    await expect(page.getByTestId("watch-partner-account")).toHaveAttribute(
      "data-account-state",
      "signed-out",
    )
  })
})
