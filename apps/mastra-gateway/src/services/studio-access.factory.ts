import { getBootstrapAdminEmails } from "@/config/env"

import { studioAccessRepository } from "./studio-access.repository"
import { createStudioAccessService } from "./studio-access.service"

export function createGatewayStudioAccessService() {
  return createStudioAccessService({
    repository: studioAccessRepository,
    bootstrapAdminEmails: getBootstrapAdminEmails(),
  })
}
