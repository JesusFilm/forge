import { notFound } from "next/navigation"
import { SignedSimulatorGate } from "@/components/SignedSimulatorGate"
import { readQrContext } from "@/lib/contracts"
import { signedSimulatorConfig } from "@/server/signedSimulator"

export const dynamic = "force-dynamic"
export default async function SimulatorFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!signedSimulatorConfig()) notFound()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams))
    if (typeof value === "string") query.set(key, value)
  return <SignedSimulatorGate tvContext={readQrContext(query)} />
}
