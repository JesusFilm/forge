import { start } from "workflow/api"

import {
  runSubtitleEval,
  type SubtitleEvalWorkflowInput,
} from "@/workflows/subtitleEval"

export async function launchSubtitleEval(input: SubtitleEvalWorkflowInput) {
  return start(runSubtitleEval, [input])
}
