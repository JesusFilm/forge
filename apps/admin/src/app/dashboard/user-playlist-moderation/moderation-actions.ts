"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import { requireAdminSession } from "@/auth/session"
import { prisma } from "@/db/client"
import {
  USER_PLAYLIST_BLOCK_REASONS,
  USER_PLAYLIST_RESTORE_REASONS,
} from "@/domain/user-playlist-moderation"
import { getUserPlaylistGraphqlRuntime } from "@/graphql/user-playlist-runtime"

const ModerationActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      playlistId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/),
      action: z.literal("BLOCK"),
      reason: z.enum(USER_PLAYLIST_BLOCK_REASONS),
    })
    .strict(),
  z
    .object({
      playlistId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/),
      action: z.literal("RESTORE"),
      reason: z.enum(USER_PLAYLIST_RESTORE_REASONS),
    })
    .strict(),
])

export type UserPlaylistModerationActionInput = z.input<
  typeof ModerationActionSchema
>

export type UserPlaylistModerationActionState =
  | {
      status: "success"
      action: "BLOCK" | "RESTORE"
      playlistId: string
      changed: boolean
    }
  | { status: "error" }

export async function moderateUserPlaylist(
  untrustedInput: unknown,
): Promise<UserPlaylistModerationActionState> {
  const principal = await requireAdminSession()
  if (!hasPermission(principal, "moderate:user-playlists")) {
    return { status: "error" }
  }

  const input = ModerationActionSchema.safeParse(untrustedInput)
  if (!input.success) return { status: "error" }

  try {
    const moderation = getUserPlaylistGraphqlRuntime(prisma).moderation()
    const result =
      input.data.action === "BLOCK"
        ? await moderation.block(
            {
              playlistId: input.data.playlistId,
              reasonCode: input.data.reason,
            },
            principal,
          )
        : await moderation.restore(
            {
              playlistId: input.data.playlistId,
              reasonCode: input.data.reason,
            },
            principal,
          )

    revalidatePath("/dashboard/user-playlist-moderation")
    return {
      status: "success",
      action: input.data.action,
      playlistId: input.data.playlistId,
      changed: result.changed,
    }
  } catch (error) {
    console.warn(
      `[user-playlist-moderation] event=action_failed action=${input.data.action} error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
    )
    return { status: "error" }
  }
}
