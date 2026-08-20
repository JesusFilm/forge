import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}))

import VideoPipelinePreviewPage from "./page"

describe("VideoPipelinePreviewPage", () => {
  it("renders the cell title, date, and both device panels for a finished day", async () => {
    const element = await VideoPipelinePreviewPage({
      params: Promise.resolve({ cellId: "devotion-2026-08-01" }),
    })
    const markup = renderToStaticMarkup(element as React.ReactElement)

    expect(markup).toContain("The night the ordinary sky")
    expect(markup).toContain("August 1, 2026")
    expect(markup).toContain("Mobile")
    expect(markup).toContain("Desktop")
    expect(markup).not.toContain("Not generated yet")
    expect(notFoundMock).not.toHaveBeenCalled()
  })

  it("shows a 'Not generated yet' panel for an aspect that isn't finished", async () => {
    const element = await VideoPipelinePreviewPage({
      params: Promise.resolve({ cellId: "devotion-2026-08-08" }),
    })
    const markup = renderToStaticMarkup(element as React.ReactElement)

    expect(markup).toContain("Not generated yet")
  })

  it("finds a cell in a non-August month and labels the back-link with its month", async () => {
    const element = await VideoPipelinePreviewPage({
      params: Promise.resolve({ cellId: "devotion-2026-09-01" }),
    })
    const markup = renderToStaticMarkup(element as React.ReactElement)

    expect(markup).toContain("Devotions - September")
    expect(markup).toContain("Not generated yet")
  })

  it("calls notFound() for an unknown cell id", async () => {
    await expect(
      VideoPipelinePreviewPage({
        params: Promise.resolve({ cellId: "not-a-real-id" }),
      }),
    ).rejects.toThrow("not-found")

    expect(notFoundMock).toHaveBeenCalled()
  })
})
