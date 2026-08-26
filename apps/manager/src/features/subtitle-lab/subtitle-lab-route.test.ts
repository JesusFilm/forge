import { describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const reviewerAuthMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth", () => ({
  authenticateInteractiveManagerRequest: vi.fn(),
  authenticateInteractiveReviewerRequest: reviewerAuthMock,
}))

import { requireSubtitleLabReviewer } from "./subtitle-lab-route"

describe("Subtitle Lab reviewer BFF guard", () => {
  it("turns a wrong reviewer or service actor into a private non-disclosing 404", async () => {
    reviewerAuthMock.mockResolvedValueOnce(
      NextResponse.json(
        { error: "Interactive reviewer session required" },
        { status: 404 },
      ),
    )

    const response = await requireSubtitleLabReviewer(
      new Request("https://manager.example/api/subtitle-lab/assignments"),
    )

    expect(response).toBeInstanceOf(Response)
    const denial = response as Response
    expect(denial.status).toBe(404)
    expect(await denial.json()).toEqual({ error: "Not found" })
    expect(denial.headers.get("cache-control")).toBe("private, no-store")
  })
})
