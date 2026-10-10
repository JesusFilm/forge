import { NextResponse } from "next/server"
import {
  SEO_WORKLOAD_ASSERTION_HEADER,
  verifySeoWorkloadAssertion,
} from "@/auth/seo-service-assertion"
import { prisma } from "@/db/client"
import {
  SeoExperimentService,
  SeoTicketsInput,
} from "@/services/seo-experiment.service"
import { parseSeoJson, readBoundedSeoBody, seoRouteError } from "../route-utils"

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedSeoBody(request)
    const assertion = await verifySeoWorkloadAssertion({
      assertion: request.headers.get(SEO_WORKLOAD_ASSERTION_HEADER),
      capability: "tickets",
      rawBody,
    })
    const input = SeoTicketsInput.parse(parseSeoJson(rawBody))
    const service = new SeoExperimentService(prisma)
    const result =
      input.action === "claim"
        ? await service.claimTicket({ assertion, input })
        : await service.finishTicket({ assertion, input })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return seoRouteError(error)
  }
}
