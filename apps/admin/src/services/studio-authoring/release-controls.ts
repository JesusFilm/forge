import { env } from "@/config/env"
import { StudioCommandError } from "./errors"

/** Process configuration takes effect on restart; it is not an instantaneous fleet barrier. */
export function assertStudioProductionEnabled() {
  if (env.STUDIO_PRODUCTION_ENABLED !== "true")
    throw new StudioCommandError("PRODUCTION_DISABLED")
}
export function assertStudioPublicationEnabled() {
  if (env.STUDIO_PUBLICATION_ENABLED !== "true")
    throw new StudioCommandError("PUBLICATION_DISABLED")
}
