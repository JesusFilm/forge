import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { schema } from "@/graphql/schema"
import { paginateOwnerPlaylists } from "@/graphql/types/user-playlist"

function fields(typeName: string) {
  const type = schema.getType(typeName) as
    | { getFields(): Record<string, { type: unknown; args?: unknown[] }> }
    | undefined
  expect(type, `${typeName} must be registered`).toBeDefined()
  return type!.getFields()
}

describe("User Playlist GraphQL contract", () => {
  it("registers the owner, public, report, and moderation roots", () => {
    expect(Object.keys(schema.getQueryType()!.getFields())).toEqual(
      expect.arrayContaining([
        "myUserPlaylists",
        "myUserPlaylist",
        "myUserPlaylistCapability",
        "userPlaylistByToken",
        "userPlaylistReportQueue",
      ]),
    )
    expect(Object.keys(schema.getMutationType()!.getFields())).toEqual(
      expect.arrayContaining([
        "createUserPlaylist",
        "updateUserPlaylist",
        "deleteUserPlaylist",
        "unshareUserPlaylist",
        "reshareUserPlaylist",
        "rotateUserPlaylistCapability",
        "reportUserPlaylist",
        "blockUserPlaylist",
        "restoreUserPlaylist",
      ]),
    )
  })

  it("pins exact owner and moderator permission declarations", () => {
    const queries = schema.getQueryType()!.getFields()
    const mutations = schema.getMutationType()!.getFields()
    const scopes = (field: { extensions?: Record<string, unknown> }) =>
      (field.extensions as { pothosOptions?: { authScopes?: unknown } })
        ?.pothosOptions?.authScopes
    expect(scopes(queries.myUserPlaylists!)).toEqual({
      hasPermission: "read:user-playlists:own",
    })
    expect(scopes(queries.myUserPlaylist!)).toEqual({
      hasPermission: "read:user-playlists:own",
    })
    expect(scopes(queries.myUserPlaylistCapability!)).toEqual({
      hasPermission: "share:user-playlists:own",
    })
    for (const name of [
      "createUserPlaylist",
      "updateUserPlaylist",
      "deleteUserPlaylist",
    ]) {
      expect(scopes(mutations[name]!)).toEqual({
        hasPermission: "write:user-playlists:own",
      })
    }
    for (const name of [
      "unshareUserPlaylist",
      "reshareUserPlaylist",
      "rotateUserPlaylistCapability",
    ]) {
      expect(scopes(mutations[name]!)).toEqual({
        hasPermission: "share:user-playlists:own",
      })
    }
    expect(scopes(queries.userPlaylistReportQueue!)).toEqual({
      hasPermission: "moderate:user-playlists",
    })
    expect(scopes(mutations.blockUserPlaylist!)).toEqual({
      hasPermission: "moderate:user-playlists",
    })
    expect(scopes(mutations.restoreUserPlaylist!)).toEqual({
      hasPermission: "moderate:user-playlists",
    })
  })

  it("keeps create behind the composite write + share check", () => {
    const source = readFileSync(
      new URL("./mutations/user-playlist.ts", import.meta.url),
      "utf8",
    )
    const helper = source.match(
      /function requireCompositeCreateScopes[\s\S]*?\n\}/,
    )?.[0]
    expect(helper).toContain(
      'hasPermission(ctx.user, "write:user-playlists:own")',
    )
    expect(helper).toContain(
      'hasPermission(ctx.user, "share:user-playlists:own")',
    )
    expect(source).toMatch(
      /createUserPlaylist:[\s\S]*?requireCompositeCreateScopes\(ctx\)/,
    )
  })

  it("returns owner playlists from sharing mutations and reserves plaintext capability for the explicit reveal query", () => {
    const mutations = schema.getMutationType()!.getFields()
    for (const name of [
      "createUserPlaylist",
      "reshareUserPlaylist",
      "rotateUserPlaylistCapability",
    ]) {
      expect(mutations[name]?.type.toString()).toBe(
        "UserPlaylistMutationResult",
      )
    }
    expect(Object.keys(fields("UserPlaylistSuccess"))).toEqual(["playlist"])
    expect(Object.keys(fields("UserPlaylistCapability"))).toEqual([
      "capability",
    ])
    expect(schema.getType("UserPlaylistCapabilityPayload")).toBeUndefined()
    expect(
      schema.getType("UserPlaylistCapabilityMutationResult"),
    ).toBeUndefined()
  })

  it("keeps the anonymous DTO free of owner and persistence fields", () => {
    const publicFields = Object.keys(fields("PublicUserPlaylist"))
    expect(publicFields).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "locale",
        "countryCode",
        "blocks",
        "reportIntent",
      ]),
    )
    expect(publicFields).not.toEqual(
      expect.arrayContaining([
        "id",
        "ownerSubject",
        "version",
        "createdAt",
        "updatedAt",
        "moderationState",
        "reports",
        "capability",
      ]),
    )
  })

  it("never accepts owner, token, role, or moderation fields in owner inputs", () => {
    for (const name of [
      "CreateUserPlaylistInput",
      "UpdateUserPlaylistInput",
      "UserPlaylistVersionedInput",
    ]) {
      const inputFields = Object.keys(fields(name))
      expect(inputFields).not.toEqual(
        expect.arrayContaining([
          "owner",
          "ownerSubject",
          "capability",
          "token",
          "role",
          "moderationState",
        ]),
      )
    }
  })

  it("does not register user playlists in generic node relations", () => {
    expect(schema.getType("UserPlaylist")).toBeUndefined()
    expect(schema.getType("PublicUserPlaylist")).toBeDefined()
    expect(schema.getType("OwnerUserPlaylist")).toBeDefined()
  })

  it("rejects a well-formed but stale owner pagination cursor", () => {
    expect(() =>
      paginateOwnerPlaylists(
        [
          {
            id: "playlist-1",
            title: "One",
            description: "",
            locale: "en",
            countryCode: null,
            version: 1,
            shared: true,
          },
        ],
        { first: 20, cursor: "missing" },
      ),
    ).toThrow("Invalid cursor")
  })
})
