export function assertHumanPublishGuard(task) {
  if (task.objective === "publish") {
    throw new Error("Policy violation: AI publish objective is forbidden.");
  }
}

export function assertModerationPassed(moderationState) {
  if (moderationState !== "passed") {
    throw new Error("Moderation must pass before review submission.");
  }
}
