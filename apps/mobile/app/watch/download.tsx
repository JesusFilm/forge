import { useRouter } from "expo-router"

import { DownloadSheetContent } from "../../src/components/watch/DownloadSheet"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

export default function DownloadSheetRoute() {
  const router = useRouter()
  const { video, activeVariant, setSnackbarMessage } = useWatchSession()

  if (!video) return null

  return (
    <DownloadSheetContent
      videoTitle={video.title}
      duration={video.duration}
      languageName={activeVariant?.languageName ?? null}
      downloads={activeVariant?.downloads ?? []}
      onDownloadComplete={() => {
        setSnackbarMessage("Download complete")
        router.back()
      }}
    />
  )
}
