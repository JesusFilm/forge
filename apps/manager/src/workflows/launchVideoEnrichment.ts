import { start } from "workflow/api"
import {
  runVideoEnrichment,
  type VideoEnrichmentInput,
} from "@/workflows/videoEnrichment"

export async function launchVideoEnrichment(input: VideoEnrichmentInput) {
  return start(runVideoEnrichment, [input])
}
