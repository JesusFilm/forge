import { type NextRequest, NextResponse } from "next/server"
import {
  admitExperienceEditorRequest,
  registerPublicGraphqlAdmission,
} from "@/services/public-request-priority"

/**
 * Let a public query dispatched in the same instant reach its handler before
 * route preparation. The matching editor request then waits once, at this
 * boundary, only while public GraphQL work is pending or active.
 */
export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/api/graphql" &&
    (request.method === "GET" || request.method === "POST")
  ) {
    registerPublicGraphqlAdmission()
  } else {
    await admitExperienceEditorRequest()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/api/graphql", "/dashboard/experiences/:id"],
}
