import { useEffect, useState } from "react"

import { getMiniPlayerStore, screenAdminForms } from "../lib/miniPlayer/store"
import { currentAdminForms, type AdminLanguageForms } from "./adminLanguage"

type Captured = { videoSlug: string; forms: AdminLanguageForms }

function capture(videoSlug: string): Captured {
  const session = getMiniPlayerStore().getSnapshot().session
  return {
    videoSlug,
    forms: screenAdminForms(session, videoSlug, currentAdminForms()),
  }
}

/** KTD16: the forms a watch or series screen reads its text with, captured at
 *  mount. A later language change never moves them (KD12); a new slug is
 *  another video, which reads them again. */
export function useScreenAdminForms(videoSlug: string): AdminLanguageForms {
  const [captured, setCaptured] = useState(() => capture(videoSlug))
  let current = captured
  if (captured.videoSlug !== videoSlug) {
    current = capture(videoSlug)
    setCaptured(current)
  }

  // The session this screen may start reads these back (see the store).
  const forms = current.forms
  useEffect(() => {
    if (videoSlug) getMiniPlayerStore().noteScreenAdminForms(videoSlug, forms)
  }, [videoSlug, forms])

  return forms
}
