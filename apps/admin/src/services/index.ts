// Service registry — assembled once per request in createContext.
//
// Each service receives the Prisma client and the requesting principal.
// Services own all mutation logic: Zod validation, ABAC checks, Prisma
// calls. Resolvers delegate to services; they never call Prisma directly
// for mutations.

import type { PrismaClient } from "@prisma/client"
import { ExperienceService } from "@/services/experience.service"
import { ExperienceSearchService } from "@/services/experience.search"
import { VideoService } from "@/services/video.service"

export type Services = ReturnType<typeof createServices>

export function createServices(prisma: PrismaClient) {
  return {
    experience: new ExperienceService(prisma),
    experienceSearch: new ExperienceSearchService(prisma),
    video: new VideoService(prisma),
  }
}
