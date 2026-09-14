export type AndroidLoadingModule = {
  showLoadingDialog: (requestId: string, message: string) => Promise<void>
  dismissLoadingDialog: (requestId: string) => Promise<void>
}

export function openAndroidLoading(
  native: AndroidLoadingModule,
  requestId: string,
  message: string,
  onBack: () => void,
): () => void {
  let active = true
  const cancel = () => {
    if (!active) return
    active = false
    onBack()
  }
  void native.showLoadingDialog(requestId, message).then(cancel, cancel)
  return () => {
    active = false
    void native.dismissLoadingDialog(requestId).catch(() => {})
  }
}
