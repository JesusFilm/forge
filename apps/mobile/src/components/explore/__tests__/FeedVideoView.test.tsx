/**
 * The one component that draws a feed player (KTD2). Its source-shape half
 * (the Android `textureView` literal, no picture-in-picture prop) lives in the
 * guards; this suite pins what reaches the native view at render.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)

import { act } from "react"
import type { VideoPlayer } from "expo-video"

import type { ExpoVideoMock } from "../../../test-utils/expoVideoMock"
import { TestRenderer } from "../../../test-utils/rnTestRenderer"
import { FeedVideoView } from "../FeedVideoView"

const video = jest.requireMock("expo-video") as ExpoVideoMock

const PICTURE_IN_PICTURE_PROPS = [
  "allowsPictureInPicture",
  "startsPictureInPictureAutomatically",
  "onPictureInPictureStart",
  "onPictureInPictureStop",
]

beforeEach(() => video.__reset())

it("hands the native view its player with no controls, no Live Text, and the caller's fit", async () => {
  const player = video.__player as unknown as VideoPlayer
  await act(async () => {
    TestRenderer.create(<FeedVideoView player={player} contentFit="cover" />)
  })

  expect(video.VideoView).toHaveBeenCalledTimes(1)
  const props = video.VideoView.mock.calls[0][0] as Record<string, unknown>
  expect(props).toMatchObject({
    player,
    nativeControls: false,
    allowsVideoFrameAnalysis: false,
    contentFit: "cover",
  })
  // R3: a clip never enters picture-in-picture.
  for (const name of PICTURE_IN_PICTURE_PROPS)
    expect(props).not.toHaveProperty(name)
})
