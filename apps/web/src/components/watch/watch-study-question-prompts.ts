import type { WatchStudyQuestionsBlock } from "@/lib/content"

export function getWatchStudyQuestionPrompts(
  studyQuestions: WatchStudyQuestionsBlock | null | undefined,
): string[] {
  return (studyQuestions?.studyQuestions ?? [])
    .map((question) => question.value)
    .filter((value): value is string => value != null && value.length > 0)
}
