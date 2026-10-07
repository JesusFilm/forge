import { getT } from "../i18n/useT"

// The one failure message for every refusal and every thrown error (KD10,
// R13); admin's log tells them apart. Read at call time, so it follows the UI
// language. The English keeps a straight U+0027 apostrophe, as SheetError does.
export function feedbackFailureMessage(): string {
  return getT("Feedback")("failureMessage")
}
