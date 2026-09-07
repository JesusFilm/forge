import { studioCoverageRejectionSchema } from "@forge/studio-contracts/production"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"

/** Only the authenticated Admin's bounded coverage contract is exposed to the model. */
export async function rejectStudioAssetTool(
  action: string,
  response: Response,
): Promise<never> {
  if (action === "validate-proposal" && response.status === 400) {
    let body: unknown
    try {
      body = JSON.parse(await readStudioBytes(response, 4096))
    } catch {
      throw new StudioBoundaryError(
        "Studio asset tool rejected",
        response.status,
      )
    }
    const parsed = studioCoverageRejectionSchema.safeParse(body)
    if (parsed.success)
      throw new StudioBoundaryError(
        `${parsed.data.feedback.code}: ${JSON.stringify(parsed.data.feedback)}. Coverage must match explicit item.speech.role identities. Put semantic QA concerns such as scripture echo in findings, not inferred role claims. Read the admitted project for any omitted facts.`,
        400,
      )
  }
  throw new StudioBoundaryError("Studio asset tool rejected", response.status)
}
