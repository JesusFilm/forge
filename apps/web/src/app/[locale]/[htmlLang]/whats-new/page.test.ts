/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }))

import { generateMetadata } from "./page"

describe("/watch/whats-new metadata", () => {
  it("keeps the announcement out of search indexes", () => {
    // Asked for explicitly: this page is for staff and partners who are sent
    // the link, not something to be found by searching. `follow: false` goes
    // with it so the crawler does not treat the page as a set of endorsed
    // routes into Watch.
    const { robots } = generateMetadata()

    expect(robots).toMatchObject({ index: false, follow: false })
    expect(robots).toMatchObject({
      googleBot: { index: false, follow: false },
    })
  })

  it("still describes itself for anyone the link is sent to", () => {
    // The counterpart: out of the index is not the same as out of sight.
    // Open Graph is what renders the card when the link is pasted into a
    // message, which is the only way this page is meant to travel.
    const metadata = generateMetadata()

    expect(metadata.openGraph?.title).toBeTruthy()
    expect(metadata.openGraph?.description).toBeTruthy()
    expect(metadata.twitter?.title).toBeTruthy()
  })
})
