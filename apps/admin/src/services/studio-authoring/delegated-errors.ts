import { ZodError } from "zod"
import { StudioBoundaryError } from "@forge/studio-server"
import { NotFoundError, ForbiddenError } from "../errors"
import { StudioCommandError } from "./errors"
/** Expected failures expose bounded guidance, never raw inputs or internal errors. */
export function studioDelegatedError(error: unknown) {
  if (error instanceof StudioCommandError)
    return { error: error.code, status: error.code === "CONFLICT" ? 409 : 400 }
  if (error instanceof StudioBoundaryError)
    return { error: error.message, status: error.status }
  if (error instanceof NotFoundError)
    return {
      error:
        "Studio resource not found. Source reads require the source snapshot id returned by shorts.capture, not a catalog video or dub id.",
      status: 404,
    }
  if (error instanceof ForbiddenError)
    return { error: "Studio access denied", status: 403 }
  if (error instanceof ZodError)
    return { error: "Invalid Studio command input", status: 400 }
  return { error: "Studio command rejected", status: 500 }
}
