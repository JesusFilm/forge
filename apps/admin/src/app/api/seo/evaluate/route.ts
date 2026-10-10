import { NextResponse } from "next/server"
import {
  SEO_WORKLOAD_ASSERTION_HEADER,
  verifySeoWorkloadAssertion,
} from "@/auth/seo-service-assertion"
import { prisma } from "@/db/client"
import {
  SeoEvaluateInput,
  SeoExperimentService,
} from "@/services/seo-experiment.service"
import { parseSeoJson, readBoundedSeoBody, seoRouteError } from "../route-utils"

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedSeoBody(request)
    const assertion = await verifySeoWorkloadAssertion({
      assertion: request.headers.get(SEO_WORKLOAD_ASSERTION_HEADER),
      capability: "evaluate",
      rawBody,
    })
    const input = SeoEvaluateInput.parse(parseSeoJson(rawBody))
    const service = new SeoExperimentService(prisma)
    const result =
      input.action === "claim_due"
        ? await service.claimDueExperiments({ assertion, input })
        : await service.recordEvaluation({ assertion, input })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return seoRouteError(error)
  }
}
