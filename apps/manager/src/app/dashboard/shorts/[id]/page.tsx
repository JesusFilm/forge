import { StudioEditor } from "@/features/video-studio/editor"
import { env } from "@/config/env"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <StudioEditor
      projectId={(await params).id}
      watchOrigin={env.NEXT_PUBLIC_WATCH_URL}
    />
  )
}
