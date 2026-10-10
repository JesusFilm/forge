export type AndroidResumeChoiceModule = {
  showResumeChoice: (requestId: string, resumeLabel: string) => Promise<string>
  dismissResumeChoice: (requestId: string) => Promise<void>
}

export function openAndroidResumeChoice(
  native: AndroidResumeChoiceModule,
  requestId: string,
  resumeLabel: string,
  callbacks: {
    onResume: () => void
    onStartOver: () => void
    onClose: () => void
  },
): () => void {
  let active = true
  void native.showResumeChoice(requestId, resumeLabel).then(
    (choice) => {
      if (!active) return
      active = false
      if (choice === "resume") callbacks.onResume()
      else if (choice === "start-over") callbacks.onStartOver()
      else callbacks.onClose()
    },
    () => {
      if (!active) return
      active = false
      callbacks.onClose()
    },
  )
  return () => {
    active = false
    void native.dismissResumeChoice(requestId).catch(() => {})
  }
}
