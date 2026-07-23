/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mediaCollectionProps } = vi.hoisted(() => ({
  mediaCollectionProps: vi.fn(),
}))

vi.mock("./MediaCollection", () => ({
  MediaCollection: (props: { surface?: string }) => {
    mediaCollectionProps(props)
    return (
      <div data-testid="nested-media-collection" data-surface={props.surface} />
    )
  },
}))

import { Section } from "./Section"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  mediaCollectionProps.mockReset()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("Section Watch-home surface propagation", () => {
  it("reaches a media collection nested inside a container slot", () => {
    const data = {
      id: "section-1",
      sectionKey: "section-1",
      backgroundColor: "default",
      backgroundOpacity: 1,
      sectionContent: [
        {
          __typename: "ContainerBlock",
          id: "container-1",
          content: [
            {
              __typename: "ContainerSlotBlock",
              t: "containerSlot",
              gridSpan: 12,
              spans: {},
            },
            {
              __typename: "MediaCollectionBlock",
              id: "media-1",
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof Section>[0]["data"]

    act(() => {
      root.render(
        <Section data={data} languageSlug="english" surface="watch-home" />,
      )
    })

    expect(mediaCollectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        languageSlug: "english",
        surface: "watch-home",
      }),
    )
    expect(
      container
        .querySelector<HTMLElement>("[data-testid='nested-media-collection']")
        ?.getAttribute("data-surface"),
    ).toBe("watch-home")
  })
})
