import { handleSeoProposalDecision } from "@/lib/seo-proposal-decision-route"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  return handleSeoProposalDecision(request, id, "approve")
}
