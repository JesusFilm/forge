import { feedbackUrl, type FeedbackContext } from "./feedbackUrl"

export const SIMULATOR_FEEDBACK_REFERENCE = "Simulator test · LOCAL-PREVIEW"
export const SIMULATOR_FEEDBACK_DESCRIPTION =
  "Scan with your phone. Reports save locally; sending to Linear is optional."
export const HOSTED_SIMULATOR_FEEDBACK_REFERENCE = "Simulator test"
export const HOSTED_SIMULATOR_FEEDBACK_DESCRIPTION =
  "Simulator test — feedback goes to the TV beta team. Scan with your phone to send a report."

const HOSTED_SIMULATOR_BASE =
  "https://web-staging-7801.up.railway.app/tv/simulator"
const MAX_SIMULATOR_TOKEN_LENGTH = 2048
const MAX_SIMULATOR_URL_LENGTH = 2400

/** Reserve simulator receivers even when their token or configuration is invalid. */
export function isSimulatorFeedbackDestination(
  base: string | undefined,
): boolean {
  if (!base) return false
  try {
    const { pathname } = new URL(base)
    return pathname === "/tv/local" || pathname === "/tv/simulator"
  } catch {
    return false
  }
}

export function isHostedSimulatorFeedbackDestination(
  base: string | undefined,
): boolean {
  if (!base) return false
  try {
    return new URL(base).pathname === "/tv/simulator"
  } catch {
    return false
  }
}

function contextQuery(context: FeedbackContext): string {
  const encoded = feedbackUrl("https://context.invalid/tv", context)
  return encoded ? new URL(encoded).search : ""
}

function hostedSimulatorFeedbackUrl(
  base: string,
  context: FeedbackContext,
): string | null {
  const prefix = `${HOSTED_SIMULATOR_BASE}#token=`
  if (!base.startsWith(prefix)) return null
  const token = base.slice(prefix.length)
  // This checks transport shape only. The receiving server verifies EdDSA,
  // claims, expiry and authorization; the TV must never claim token verification.
  if (
    token.length > MAX_SIMULATOR_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/.test(token)
  )
    return null
  const url = `${HOSTED_SIMULATOR_BASE}${contextQuery(context)}#token=${token}`
  // Leave room beneath QR version 40/L's byte capacity, including context.
  return url.length <= MAX_SIMULATOR_URL_LENGTH ? url : null
}

export function feedbackSimulatorEnabled({
  flag,
  development,
  tv,
  nativeSimulator,
}: {
  flag: string | undefined
  development: boolean
  tv: boolean
  nativeSimulator: boolean
}): boolean {
  return flag === "true" && development && tv && nativeSimulator
}

/** A phone must reach the Mac directly; loopback and public hosts are not local receivers. */
export function simulatorFeedbackUrl(
  base: string | undefined,
  context: FeedbackContext,
): string | null {
  if (!base || base !== base.trim()) return null
  if (base.length > MAX_SIMULATOR_URL_LENGTH) return null
  const hosted = hostedSimulatorFeedbackUrl(base, context)
  if (hosted) return hosted
  const match = /^(http):\/\/([0-9.]+)(?::([0-9]{1,5}))?\/tv\/local$/.exec(base)
  if (!match) return null
  const octets = match[2].split(".")
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !/^(0|[1-9][0-9]{0,2})$/.test(octet) || Number(octet) > 255,
    )
  )
    return null
  const [first, second] = octets.map(Number)
  if (
    first !== 10 &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && second === 168)
  )
    return null
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535))
    return null
  // Reuse the normal context sanitizer without changing the release URL policy.
  const url = `${base}${contextQuery(context)}`
  return url.length <= MAX_SIMULATOR_URL_LENGTH ? url : null
}
