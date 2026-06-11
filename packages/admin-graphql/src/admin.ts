// Internal shim for the fragments tree, which imports "../../admin"
// extensionless (bundler-style). The real implementation lives in index.ts.
// The extensionless re-export below is safe because NodeNext consumers
// (apps/yt-video-mapper-backend) only ever pull the "." entry (index.ts),
// which does not import this file — so this file never enters a NodeNext
// program and TS2835 cannot fire. Bundler consumers (web/tv/mobile) resolve
// extensionless imports natively. Do NOT add a `.js` extension here.
export { adminGraphql, readFragment } from "./index"
export type { AdminFragmentOf, AdminResultOf, AdminVariablesOf } from "./index"
