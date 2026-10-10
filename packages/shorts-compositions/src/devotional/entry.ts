// Remotion bundle entry for the devotional composition ONLY — passed to
// bundle() by the local render script. Kept separate from the production
// short's entry.ts so the two never interfere.
import { registerRoot } from "remotion"

import { DevotionalRoot } from "./Root"

registerRoot(DevotionalRoot)
