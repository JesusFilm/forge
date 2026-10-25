import { prisma } from "@/db/client"
import {
  resolveSubtitleTranscriptSource,
  type SubtitleTranscriptSourceResolution,
  type TranscriptSourceResolverTarget,
} from "@/services/transcript-source-resolver.service"

/**
 * Resolve Admin/Core subtitle timed text for one transcript embedding target.
 *
 * Kept outside the workflow file because the resolver performs guarded network
 * fetches and parsing work; useworkflow should journal the resolved source or
 * typed gap rather than replaying remote subtitle reads from workflow scope.
 */
export async function stepResolveSubtitleTranscriptSource(
  target: TranscriptSourceResolverTarget,
): Promise<SubtitleTranscriptSourceResolution> {
  "use step"
  return resolveSubtitleTranscriptSource(prisma, target)
}
