import { render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import { VideoCard } from "./video-card"

// Exercise a rejected import through real next/dynamic and React boundaries,
// rather than treating a player render throw as a chunk-load failure.
vi.mock("@forge/video-player/mux-video", () => {
  throw new Error("synthetic player import failure")
})

afterEach(() => vi.restoreAllMocks())

it("offers refresh guidance on every affected card while keeping watch links usable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const video = {
    videoId: "vid_1",
    title: "Jesus Calms the Storm",
    playbackId: "abcdEFGH1234",
    durationSeconds: 754,
    watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
  }
  const { container } = render(
    <>
      <p>Your conversation remains available.</p>
      <VideoCard video={video} />
      <VideoCard video={{ ...video, title: "Another video" }} />
    </>,
  )
  expect(
    await screen.findAllByText("Refresh the page to try loading videos again."),
  ).toHaveLength(2)
  expect(screen.getByText("Your conversation remains available.")).toBeVisible()
  expect(screen.getAllByRole("link")).toHaveLength(2)
  expect(container.querySelector(".aspect-video")).toBeNull()
  expect(container).not.toHaveTextContent("synthetic player import failure")
})
