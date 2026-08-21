import { describe, expect, it } from "vitest"
import { normalizeUserPlaylistBlockInput } from "./mutations/user-playlist"
import { mapUserPlaylistError } from "./types/user-playlist"
import {
  ConcurrentModificationError,
  InvalidInputError,
  LimitExceededError,
  NotFoundError,
  ServiceUnavailableError,
} from "@/services/errors"

describe("User Playlist resolver boundary", () => {
  it("normalizes only the closed block input variants", () => {
    expect(
      normalizeUserPlaylistBlockInput({ kind: "text", text: "Welcome" }),
    ).toEqual({ t: "text", text: "Welcome" })
    expect(
      normalizeUserPlaylistBlockInput({
        kind: "mediaCollection",
        title: "Watch",
        items: [{ videoId: "video-1" }],
      }),
    ).toEqual({
      t: "mediaCollection",
      title: "Watch",
      items: [{ videoId: "video-1" }],
    })
    expect(() =>
      normalizeUserPlaylistBlockInput({
        kind: "text",
        text: "Welcome",
        items: [{ videoId: "video-1" }],
      }),
    ).toThrow(InvalidInputError)
  })

  it("maps service errors to fixed, non-identifying result codes", () => {
    expect(
      mapUserPlaylistError(new NotFoundError("Playlist", "secret")),
    ).toEqual({
      kind: "error",
      code: "NOT_FOUND",
      message: "Playlist not found",
    })
    expect(
      mapUserPlaylistError(new ConcurrentModificationError("Playlist")),
    ).toMatchObject({ code: "CONFLICT" })
    expect(
      mapUserPlaylistError(new InvalidInputError("sensitive")),
    ).toMatchObject({
      code: "INVALID_INPUT",
    })
    expect(mapUserPlaylistError(new LimitExceededError())).toMatchObject({
      code: "LIMIT_EXCEEDED",
    })
    expect(mapUserPlaylistError(new ServiceUnavailableError())).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    })
    expect(mapUserPlaylistError(new Error("unexpected"))).toBeNull()
  })
})
