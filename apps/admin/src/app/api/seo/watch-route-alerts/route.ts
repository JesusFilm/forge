import { NextResponse } from "next/server"
import { z } from "zod"

import {
  SEO_WORKLOAD_ASSERTION_HEADER,
  verifySeoWorkloadAssertion,
} from "@/auth/seo-service-assertion"
import { prisma } from "@/db/client"
import {
  WatchRouteAlertClaimInput,
  WatchRouteAlertCompleteInput,
  WatchRouteAlertService,
} from "@/services/watch-route-alert.service"
import { WatchRouteManifestStore } from "@/services/watch-route-manifest-store"
import { parseSeoJson, readBoundedSeoBody, seoRouteError } from "../route-utils"

const WatchRouteAlertRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("claim_run"),
      input: WatchRouteAlertClaimInput,
    })
    .strict(),
  z
    .object({
      action: z.literal("complete_run"),
      input: WatchRouteAlertCompleteInput,
    })
    .strict(),
])

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedSeoBody(request)
    const assertion = await verifySeoWorkloadAssertion({
      assertion: request.headers.get(SEO_WORKLOAD_ASSERTION_HEADER),
      capability: "watch_alerts",
      rawBody,
    })
    const requestBody = WatchRouteAlertRequest.parse(parseSeoJson(rawBody))
    const service = new WatchRouteAlertService(prisma)

    if (requestBody.action === "complete_run") {
      const result = await service.completeRun({
        assertion,
        input: requestBody.input,
      })
      return NextResponse.json({ ok: true, result })
    }

    const snapshot =
      requestBody.input.mode === "off"
        ? null
        : await new WatchRouteManifestStore(prisma).getLatest()
    if (requestBody.input.mode !== "off" && !snapshot) {
      return NextResponse.json(
        { ok: false, error: "watch_route_manifest_unavailable" },
        { status: 503 },
      )
    }
    const result = await service.claimRun({
      assertion,
      input: requestBody.input,
    })
    if (!result.claim) {
      return NextResponse.json({
        ok: true,
        result: { ...result, manifest: null },
      })
    }

    return NextResponse.json({
      ok: true,
      result: { ...result, manifest: snapshot!.payload },
    })
  } catch (error) {
    return seoRouteError(error)
  }
}
