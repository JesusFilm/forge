import { StudioEditor } from "@/features/video-studio/editor"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <StudioEditor projectId={(await params).id} />
}
