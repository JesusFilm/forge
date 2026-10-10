import { StudioEditor } from "@/features/video-studio/editor"
import { parseRenderHandoff } from "@/features/video-studio/render-review-state"
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <StudioEditor
      projectId={(await params).id}
      handoff={parseRenderHandoff(await searchParams)}
    />
  )
}
