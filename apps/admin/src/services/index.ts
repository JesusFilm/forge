// Service registry — assembled once per request in createContext.
//
// Each service receives the Prisma client and the requesting principal.
// Services own all mutation logic: Zod validation, ABAC checks, Prisma
// calls. Resolvers delegate to services; they never call Prisma directly
// for mutations.

import type { PrismaClient } from "@prisma/client"
import { ExperienceService } from "@/services/experience.service"
import { ExperienceSearchService } from "@/services/experience.search"
import { ManagerJobService } from "@/services/manager-job.service"
import { ManagerReadModelService } from "@/services/manager-read-model.service"
import { MediaAssetService } from "@/services/media-asset.service"
import { MediaFolderService } from "@/services/media-folder.service"
import { ScripturePassageService } from "@/services/scripture-passage.service"
import { VideoService } from "@/services/video.service"
import { WatchEventService } from "@/services/watch-events.service"
import { WatchSettingService } from "@/services/watch-setting.service"

export type Services = ReturnType<typeof createServices>

export function createServices(prisma: PrismaClient) {
  return {
    experience: new ExperienceService(prisma),
    experienceSearch: new ExperienceSearchService(prisma),
    managerJob: new ManagerJobService(prisma),
    managerReadModel: new ManagerReadModelService(prisma),
    mediaAsset: new MediaAssetService(prisma),
    mediaFolder: new MediaFolderService(prisma),
    scripturePassage: new ScripturePassageService(prisma),
    video: new VideoService(prisma),
    watchEvent: new WatchEventService(prisma),
    watchSetting: new WatchSettingService(prisma),
  }
}
