import type { Metadata } from "next"
import { VideoPipelinesClient } from "@/features/video-pipelines/video-pipelines-client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Video Pipelines -- Studio",
}

export default function VideoPipelinesPage() {
  return <VideoPipelinesClient />
}
