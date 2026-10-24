import { z } from "zod"

export const ListMediaFoldersInput = z.object({})
export type ListMediaFoldersInput = z.infer<typeof ListMediaFoldersInput>

export const CreateMediaFolderInput = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).nullable().optional(),
})
export type CreateMediaFolderInput = z.infer<typeof CreateMediaFolderInput>

export const UpdateMediaFolderInput = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().min(1).nullable().optional(),
})
export type UpdateMediaFolderInput = z.infer<typeof UpdateMediaFolderInput>

export const DeleteMediaFolderInput = z.object({
  id: z.string().min(1),
})
export type DeleteMediaFolderInput = z.infer<typeof DeleteMediaFolderInput>
