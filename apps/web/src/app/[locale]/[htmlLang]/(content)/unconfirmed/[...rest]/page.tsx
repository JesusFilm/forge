// Reuse the admitted content renderer without its Full Route Cache policy.
// The proxy selects this internal route only while manifest proof is inconclusive.
export { default, generateMetadata } from "../../[...rest]/page"

export const dynamic = "force-dynamic"
