// Worker bundle entry ONLY — passed to Remotion's bundle() at shorts-worker
// Docker build time. Player consumers must import from the package root.
import { registerRoot } from "remotion"

import { Root } from "./Root"

registerRoot(Root)
